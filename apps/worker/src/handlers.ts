import { z } from 'zod';
import { parseJobPayload, parseJobResult, planWeek, parseMoney, jobResultSchemas, type JobKind, type TimeWindow } from '@personal-ai-os/domain';
import type { WorkerClient } from './client.js';
import { rpc } from './client.js';
import type { WorkerConfig } from './config.js';
import { ProviderError, jsonRequest } from './http.js';
import { StateStore } from './state.js';
import { structuredModel } from './llm.js';
import { applyCalendar, syncCalendar } from './connectors/calendar.js';
import { syncProjects } from './connectors/github.js';

export interface LeasedJob { id: string; owner_id: string; kind: JobKind; payload: Record<string, unknown>; lease_token: string; lease_until?: string; attempt?: number }
export interface ContextRecord { id: string; kind: string; title: string; status: string; due_at?: string; data: Record<string, unknown> }
interface SourceFile { storage_path?: string; mime: string; file_name?: string; title: string; size_bytes?: number; data?: Record<string, unknown> }
interface JobContext { document?: SourceFile; evidence?: SourceFile; records?: ContextRecord[]; settings?: Record<string, Record<string, unknown>> }
export interface Extraction { text: string; fragments: Array<{ locator: Record<string, unknown>; text: string }>; warnings: string[] }

export async function extractFile(client: WorkerClient, source: SourceFile, config: WorkerConfig, signal?: AbortSignal): Promise<Extraction> {
  if (!source.storage_path || (source.size_bytes ?? 0) > config.maxFileBytes) throw new ProviderError('source_file_missing_or_too_large', false);
  const { data, error } = await client.storage.from(config.bucket).download(source.storage_path);
  if (error || !data) throw new ProviderError('source_download_failed', true);
  if (data.size > config.maxFileBytes) throw new ProviderError('source_file_too_large', false);
  const form = new FormData();
  const extension: Record<string, string> = { 'text/plain': '.txt', 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx' };
  const fileName = source.file_name || `document${extension[source.mime] ?? ''}`;
  form.append('file', data, fileName.replace(/[/\\]/g, '_'));
  const result = await jsonRequest<Extraction>(new URL('/extract', config.extractorUrl), { method: 'POST', body: form, signal }, 55000);
  return jobResultSchemas['document.extract'].parse(result) as Extraction;
}
export function extractFinance(text: string) {
  const warnings = ['draft_requires_human_review'];
  const currency = /\b(USD|EUR|CLP|GBP|JPY|BRL)\b/i.exec(text)?.[1]?.toUpperCase();
  const defaultCurrency = process.env.FINANCE_DEFAULT_CURRENCY ?? 'CLP';
  if (!currency) warnings.push(`currency_assumed_${defaultCurrency}_verify`);
  const total = /(?:total(?:\s+a\s+pagar)?|monto(?:\s+total)?)\s*[:=]?\s*(?:CLP|USD|EUR)?\s*\$?\s*([\d][\d.,]*)/i.exec(text)?.[1];
  let amountMinor: number | undefined;
  if (total) { try { amountMinor = parseMoney(total, currency ?? defaultCurrency); if (amountMinor < 0) amountMinor = undefined; } catch { warnings.push('ambiguous_amount_requires_review'); } }
  const merchant = /(?:comercio|merchant|raz[oó]n social)\s*:\s*([^\r\n]{1,200})/i.exec(text)?.[1]?.trim();
  return { ...(merchant ? { merchant } : {}), ...(amountMinor !== undefined ? { amount_minor: amountMinor } : {}), currency: currency ?? defaultCurrency, description: text.replace(/\b\d{12,19}\b/g, '[número oculto]').slice(0, 1000), confidence: amountMinor === undefined ? 0.1 : 0.6, warnings };
}
export function subtractBusy(availability: TimeWindow[], busy: TimeWindow[], bufferMinutes = 10): TimeWindow[] {
  let windows = availability.map(w => ({ start: Date.parse(w.startAt), end: Date.parse(w.endAt) }));
  for (const event of busy) {
    const start = Date.parse(event.startAt) - bufferMinutes * 60000; const end = Date.parse(event.endAt) + bufferMinutes * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    windows = windows.flatMap(w => end <= w.start || start >= w.end ? [w] : [{ start: w.start, end: Math.min(start, w.end) }, { start: Math.max(end, w.start), end: w.end }].filter(p => p.end > p.start));
  }
  return windows.map(w => ({ startAt: new Date(w.start).toISOString(), endAt: new Date(w.end).toISOString() }));
}
const availabilitySchema = z.array(z.object({ startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) })).max(100);

export async function executeJob(client: WorkerClient, job: LeasedJob, config: WorkerConfig, state: StateStore, signal?: AbortSignal) {
  const payload = parseJobPayload(job.kind, job.payload) as Record<string, unknown>;
  const context = await rpc<JobContext>(client, 'get_job_context', { p_job_id: job.id, p_lease_token: job.lease_token });
  let result: unknown;
  switch (job.kind) {
    case 'document.extract': {
      if (!context.document) throw new ProviderError('document_not_found', false);
      result = await extractFile(client, context.document, config, signal); break;
    }
    case 'finance.extract': {
      if (!context.evidence) throw new ProviderError('evidence_not_found', false);
      const extracted = await extractFile(client, context.evidence, config, signal);
      const draft = extractFinance(extracted.text);
      if (process.env.FINANCE_EXTERNAL_AI_ALLOWED === 'true' && extracted.text) {
        try { result = await structuredModel(state, jobResultSchemas['finance.extract'], `Extract a financial receipt into a draft. Never classify it as paid based only on receipt text. No unknown date or amount guesses.\n<evidence>\n${draft.description}\n</evidence>`, signal); }
        catch { result = { ...draft, warnings: [...draft.warnings, ...extracted.warnings, 'model_unavailable_used_local_extraction'] }; }
      } else result = { ...draft, warnings: [...draft.warnings, ...extracted.warnings] };
      break;
    }
    case 'calendar.sync': {
      const id = String(payload.connection_id); const saved = await state.read<{ sync_cursor?: string }>(`calendar-${Buffer.from(id).toString('hex')}`, {});
      result = await syncCalendar(id, saved.sync_cursor, signal); break;
    }
    case 'calendar.apply': result = await applyCalendar(client, job.id, job.lease_token, String(payload.action_id), signal); break;
    case 'planner.week': {
      const raw = payload.availability ?? context.settings?.preferences?.availability ?? [];
      const availability = availabilitySchema.parse(raw);
      const busy = (context.records ?? []).filter(r => r.kind === 'event' && r.status !== 'cancelled').map(r => ({ startAt: String(r.data.start_at ?? r.due_at ?? ''), endAt: String(r.data.end_at ?? '') }));
      const tasks = (context.records ?? []).filter(r => r.kind === 'task' && !['done', 'completed', 'cancelled'].includes(r.status)).map(r => ({ id: r.id, title: r.title, durationMinutes: Number(r.data.duration_minutes ?? 45), priority: Number(r.data.priority ?? 3), ...(r.due_at ? { dueAt: r.due_at } : {}), kind: z.enum(['study', 'training', 'work', 'rest']).catch('work').parse(r.data.kind) }));
      const plan = planWeek({ availability: subtractBusy(availability, busy), tasks });
      result = { summary: `${plan.blocks.length} bloques propuestos; ${plan.unscheduled.length} tareas requieren ajustar capacidad. No se modificó el calendario.`, blocks: plan.blocks.map(b => ({ title: b.title, start_at: b.startAt, end_at: b.endAt, kind: b.kind, source_id: b.sourceId })), warnings: [...plan.warnings, ...(availability.length ? [] : ['define_explicit_availability_windows_excluding_sleep_and_personal_time'])] }; break;
    }
    case 'fitness.sync': {
      if (payload.source === 'garmin') throw new ProviderError('garmin_official_access_not_configured_use_import', false);
      const metrics = z.array(z.object({ name: z.string().min(1).max(200), value: z.number().finite(), unit: z.string().max(40), observed_at: z.iso.datetime({ offset: true }) }).passthrough()).max(1000).parse(payload.metrics ?? []);
      result = { metrics, summary: `${metrics.length} métricas importadas con fecha y unidad; no constituyen diagnóstico.`, warnings: metrics.length ? [] : ['no_metrics_provided_use_authorized_normalized_import'] }; break;
    }
    case 'life.organize': {
      const selected = (context.records ?? []).filter(r => !Array.isArray(payload.record_ids) || payload.record_ids.includes(r.id));
      result = { proposals: selected.slice(0, 100).map(r => ({ record_id: r.id, summary: `Revisar clasificación y vinculación de «${r.title}» con sus objetivos.`, suggested_title: r.title.trim().replace(/\s+/g, ' ') })), warnings: ['suggestions_only_original_files_never_deleted'] }; break;
    }
    case 'projects.sync': result = await syncProjects(z.array(z.string()).parse(payload.repositories ?? []), signal); break;
    default: throw new ProviderError('unsupported_job_kind', false);
  }
  return parseJobResult(job.kind, result);
}
