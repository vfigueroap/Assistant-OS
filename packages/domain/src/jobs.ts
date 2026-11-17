import { z } from 'zod';

export const jobKinds = ['document.extract', 'finance.extract', 'calendar.sync', 'calendar.apply', 'planner.week', 'fitness.sync', 'life.organize', 'projects.sync'] as const;
export type JobKind = typeof jobKinds[number];
const id = z.uuid();
const jsonObject = z.record(z.string(), z.unknown());
const warnings = z.array(z.string().max(1000)).max(100).optional();
const instant = z.iso.datetime({ offset: true });
const block = z.object({ title: z.string().min(1).max(500), start_at: instant, end_at: instant, kind: z.enum(['study', 'training', 'work', 'rest']), source_id: id.optional() }).refine((v) => Date.parse(v.end_at) > Date.parse(v.start_at), 'Block must end after it starts');

export const jobPayloadSchemas = {
  'document.extract': z.object({ document_id: id }).passthrough(),
  'finance.extract': z.object({ evidence_id: id }).passthrough(),
  'calendar.sync': z.object({ connection_id: z.string().min(1).max(200), provider: z.literal('google').default('google') }).passthrough(),
  'calendar.apply': z.object({ action_id: id }),
  'planner.week': z.object({ start_at: instant.optional(), end_at: instant.optional(), request: z.string().max(10000).optional() }).passthrough(),
  'fitness.sync': z.object({ source: z.enum(['garmin', 'import', 'manual']).default('manual') }).passthrough(),
  'life.organize': z.object({ record_ids: z.array(id).max(100).optional(), request: z.string().max(10000).optional() }).passthrough(),
  'projects.sync': z.object({ repositories: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(20).optional() }).passthrough(),
} satisfies Record<JobKind, z.ZodType>;

export const jobResultSchemas = {
  'document.extract': z.object({ text: z.string().max(2_000_000).optional(), fragments: z.array(z.object({ locator: z.object({ page: z.number().int().positive().optional(), slide: z.number().int().positive().optional(), sheet: z.string().optional(), row: z.number().int().positive().optional(), paragraph: z.number().int().positive().optional(), line: z.number().int().positive().optional(), cell_range: z.string().max(100).optional() }).passthrough(), text: z.string().min(1).max(30000) })).max(3000), summary: z.string().max(20000).optional(), warnings }),
  'finance.extract': z.object({ merchant: z.string().max(500).optional(), amount_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), occurred_at: z.string().max(100).optional(), description: z.string().max(10000).optional(), confidence: z.number().min(0).max(1).optional(), warnings }),
  'calendar.sync': z.object({ events: z.array(z.object({ external_id: z.string().min(1).max(1000), title: z.string().max(1000), start_at: z.string().max(100).optional(), end_at: z.string().max(100).optional(), status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(), data: jsonObject.optional() }).refine(event => event.status === 'cancelled' || (!!event.start_at && !!event.end_at && Number.isFinite(Date.parse(event.start_at)) && Date.parse(event.end_at) > Date.parse(event.start_at)), 'An active calendar event requires valid start and end dates')).max(2000), sync_cursor: z.string().max(10000).optional(), full_sync_at: instant.optional(), warnings }),
  'calendar.apply': z.object({ outcome: z.enum(['succeeded', 'unknown']), external_id: z.string().max(1000).optional(), etag: z.string().max(1000).optional(), details: jsonObject.optional() }),
  'planner.week': z.object({ summary: z.string().max(20000), blocks: z.array(block).max(200), warnings }),
  'fitness.sync': z.object({ metrics: z.array(jsonObject).max(1000).default([]), summary: z.string().max(20000).optional(), warnings }),
  'life.organize': z.object({ proposals: z.array(z.object({ record_id: id, summary: z.string().max(10000), suggested_title: z.string().max(500).optional() })).max(100), warnings }),
  'projects.sync': z.object({ projects: z.array(z.object({ repository: z.string().max(500), title: z.string().max(500), summary: z.string().max(20000), data: jsonObject.optional() })).max(100), warnings }),
} satisfies Record<JobKind, z.ZodType>;

export function parseJobPayload(kind: JobKind, payload: unknown) { return jobPayloadSchemas[kind].parse(payload); }
export function parseJobResult(kind: JobKind, result: unknown) { return jobResultSchemas[kind].parse(result); }
