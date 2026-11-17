import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { minorUnitDigits } from '@personal-ai-os/domain';
import { areas, sectionUrl, type AreaId } from '../navigation.js';
import './dashboard.css';

type RecordRow = { id: string; title: string; kind: string; status: string; due_at?: string | null; created_at?: string; data?: Record<string, unknown> };
type Metric = { key: string; label: string; value: number | string; unit?: string; currency?: string };
type Item = { id?: string; title: string; kind: string; status?: string; due_at?: string; bucket?: string; source_ref?: string };
type Telemetry = { entity_id: string; kind: string; label: string; status: string; observed_at: string; metrics: Record<string, string | number | boolean | null> };
type Snapshot = { area: string; source: string; observed_at: string; received_at: string; payload: { summary?: string; metrics?: Metric[]; items?: Item[]; references?: { source: string; external_id?: string; url?: string; local_ref?: string }[]; telemetry?: Telemetry[] } };
type Networth = { currency: string; assets_minor: number; liabilities_minor: number; networth_minor: number; as_of: string; change_percent: number | null; comparison_at: string | null };
type DashboardData = { generated_at?: string; recent?: RecordRow[]; current?: RecordRow[]; upcoming?: RecordRow[]; snapshots?: Snapshot[]; finance?: { by_currency?: { currency: string; income_minor: number; expense_minor: number; refund_minor: number; net_minor: number; draft_count: number }[]; latest_transactions?: { id: string; merchant?: string; description?: string; amount_minor: number | null; currency: string; direction: string; status: string; occurred_at?: string }[]; networth?: Networth[] }; gym?: { workout_count?: number; routine_count?: number; bodyweight_count?: number; workouts_30_days?: number; last_workout_at?: string | null; last_bodyweight?: unknown; next_training?: unknown } };
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(value)) : 'Sin fecha';
const amount = (value: number, currency: string) => {
  const digits = minorUnitDigits[currency as keyof typeof minorUnitDigits];
  if (digits === undefined || !Number.isSafeInteger(value)) return `${value} unidades menores ${currency}`;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: digits }).format(value / (10 ** digits));
};
const bucketNames: Record<string, string> = { knowledge: 'Conocimiento', skill: 'Habilidades', skills: 'Habilidades', resources: 'Recursos', network: 'Red', reputation: 'Reputación' };
const statusNames: Record<string, string> = { online: 'Conectado', idle: 'Disponible', busy: 'Trabajando', error: 'Con error', limited: 'Cuota limitada', offline: 'Desconectado', unconfigured: 'Sin configurar', active: 'Activo', completed: 'Completado', confirmed: 'Confirmado', draft: 'Por revisar', running: 'En curso', queued: 'En espera' };
const descriptions: Record<AreaId, string> = { work: 'Tu carrera, oportunidades y finanzas personales.', health: 'Entrenamiento, hábitos y próximos cuidados.', spirituality: 'Ideas para pensar y prácticas con intención.', romantic: 'Tiempo compartido, planes y fechas importantes.', 'family-friends': 'Las personas y encuentros que quieres cuidar.', 'five-buckets': 'Evidencias de lo que aprendes, practicas y construyes.', system: 'Estado observado de tus agentes, dispositivos y conexiones.', business: 'Tus proyectos, ventas y actividad comercial.', education: 'Estudios, evaluaciones y materiales de aprendizaje.' };
const itemKinds: Record<string, string[]> = { opportunities: ['opportunity'], reflections: ['reflection'], practices: ['plan', 'activity'], reminders: ['next'], plans: ['plan'], dates: ['next'], upcoming: ['next'], contacts: ['contact'], knowledge: ['learning'], skills: ['skill'], resources: ['resource'], network: ['contact'], reputation: ['reputation'], projects: ['current', 'plan'], sales: ['activity', 'current'], marketing: ['activity', 'plan'], assessments: ['next'], materials: ['learning'] };

export function Dashboard({ client, areaId, section = 'overview' }: { client: SupabaseClient; areaId?: AreaId; section?: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);
  const area = areas.find(item => item.id === areaId);
  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    try {
      const response = await client.rpc('get_dashboard', { p_area: areaId ?? null });
      if (response.error || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) throw new Error();
      if (request.current === version) { setData(response.data as DashboardData); setError(''); setNow(Date.now()); }
    } catch { if (request.current === version) setError('No se pudo actualizar el resumen. La última información disponible se conserva.'); }
    finally { if (request.current === version) setLoading(false); }
  }, [client, areaId]);
  useEffect(() => {
    setData(null); void reload();
    const interval = setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void reload(); }, 60000);
    const freshness = setInterval(() => setNow(Date.now()), 30000);
    const channel = client.channel(`dashboard-${areaId || 'home'}`);
    for (const table of ['dashboard_snapshots', 'gym_profiles', 'records', 'transactions', 'financial_valuations']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => void reload());
    channel.subscribe();
    return () => { request.current++; clearInterval(interval); clearInterval(freshness); void client.removeChannel(channel); };
  }, [reload, client, areaId]);
  const snapshots = (data?.snapshots ?? []).filter(snapshot => !areaId || snapshot.area === areaId);
  const telemetry = snapshots.flatMap(snapshot => snapshot.payload.telemetry ?? []).filter((entry, index, entries) => entries.findIndex(other => other.entity_id === entry.entity_id && other.kind === entry.kind) === index);
  const telemetryKind = ({ agents: 'agent', devices: 'device', services: 'service', connections: 'connector' } as Record<string, string>)[section];
  const selectedTelemetry = telemetry.filter(entry => !telemetryKind || entry.kind === telemetryKind);
  const items = snapshots.flatMap(snapshot => (snapshot.payload.items ?? []).map(item => ({ ...item, source: snapshot.source, observed_at: snapshot.observed_at })));
  const selectedItems = items.filter(item => section === 'overview' || !itemKinds[section] || itemKinds[section].includes(item.kind) || (item.bucket && bucketNames[item.bucket] === bucketNames[section]));
  const title = area ? area.label : 'Tu vida, de un vistazo';
  const subsection = area?.sections.find(([id]) => id === section)?.[1];
  return <div className="life-dashboard">
    <div className="life-intro"><div><p className="life-date">{new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(new Date(now))}</p><h1>{title}</h1><p>{areaId ? descriptions[areaId] : 'Lo que has hecho, lo que está en marcha y lo que viene.'}</p></div><button type="button" className="button" disabled={loading} onClick={() => void reload()}>{loading ? 'Actualizando…' : 'Actualizar'}</button></div>
    {subsection && section !== 'overview' && <h2 className="life-subtitle">{subsection} en {area?.label}</h2>}
    {error && <p className="life-error" role="alert">{error} <button type="button" onClick={() => void reload()} disabled={loading}>Volver a intentar</button></p>}
    {loading && !data && <p role="status">Cargando tu resumen…</p>}
    {data && <>
      <p className="life-freshness">Resumen consultado: <time dateTime={data.generated_at}>{date(data.generated_at)}</time></p>
      {!areaId && <><div className="life-columns"><RecordSection title="Lo próximo" records={data.upcoming ?? []} empty="No hay próximos compromisos registrados."/><RecordSection title="En marcha" records={data.current ?? []} empty="No hay actividades en curso registradas."/></div><section className="life-section"><h2>Tus áreas</h2><div className="life-areas">{areas.map(entry => { const latest = snapshots.filter(snapshot => snapshot.area === entry.id).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0]; return <a key={entry.id} href={sectionUrl(entry.id)}><strong>{entry.label}</strong><span>{latest?.payload.summary || descriptions[entry.id]}</span><small>{latest ? `Actualizado ${date(latest.observed_at)}` : 'Sin resumen publicado todavía'}</small></a>; })}</div></section><RecordSection title="Actividad reciente" records={data.recent ?? []} empty="Todavía no hay actividad registrada."/></>}
      {areaId && <>
        {(section === 'overview' || section === 'finance') && areaId === 'work' && <FinanceSummary data={data.finance}/>}
        {areaId === 'health' && ['overview', 'stats', 'upcoming', 'plans'].includes(section) && <HealthSummary data={data.gym}/>}
        {areaId === 'system' && <section className="life-section"><h2>{telemetryKind ? subsection : 'Estado del sistema'}</h2>{selectedTelemetry.length ? <div className="life-telemetry">{selectedTelemetry.map(entry => { const stale = !Number.isFinite(Date.parse(entry.observed_at)) || now - Date.parse(entry.observed_at) > 90000; return <article key={`${entry.kind}:${entry.entity_id}`}><div><h3>{entry.label}</h3><span className="life-status">{stale ? 'Sin señal reciente' : statusNames[entry.status] || entry.status}</span></div><p>{entry.kind === 'device' ? 'Dispositivo' : entry.kind === 'agent' ? 'Agente' : entry.kind === 'connector' ? 'Conexión' : 'Servicio'} · {date(entry.observed_at)}</p>{Object.keys(entry.metrics || {}).length > 0 && <dl>{Object.entries(entry.metrics).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value === null ? 'Sin datos' : typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value)}</dd></div>)}</dl>}</article>; })}</div> : <p className="life-empty">Todavía no hay telemetría publicada para esta sección. Conectar un dispositivo a Tailscale no acredita su estado operativo.</p>}</section>}
        {(section === 'overview' || ['upcoming', 'dates', 'reminders', 'assessments'].includes(section)) && <RecordSection title="Lo próximo" records={data.upcoming ?? []} empty="No hay próximos compromisos registrados."/>}
        {section === 'overview' && snapshots.filter(snapshot => snapshot.payload.summary).map(snapshot => <section className="life-section" key={snapshot.source}><h2>Resumen de {snapshot.source}</h2><p className="life-summary">{snapshot.payload.summary}</p><p className="life-freshness">Observado {date(snapshot.observed_at)}</p>{!!snapshot.payload.metrics?.length && <dl className="life-metrics">{snapshot.payload.metrics.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.currency && typeof metric.value === 'number' ? amount(metric.value, metric.currency) : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`}</dd></div>)}</dl>}</section>)}
        <section className="life-section"><h2>{areaId === 'five-buckets' ? 'Evidencias de tus baldes' : 'Actividad y próximos pasos'}</h2>{areaId === 'five-buckets' && <p className="life-explanation">Cada balde crece con evidencia: lo aprendido, lo practicado, los recursos, las relaciones y las contribuciones. Un registro puede alimentar varias áreas sin duplicarse.</p>}{selectedItems.length ? <ul className="life-list">{selectedItems.map((item, index) => <li key={`${item.source}:${item.id || index}`}><div><h3>{item.title}</h3><p>{item.bucket ? bucketNames[item.bucket] || item.bucket : statusNames[item.status || ''] || item.status || 'Registrado'} · {item.source}</p>{item.source_ref && <small>Referencia: {item.source_ref}</small>}</div>{item.due_at && <time dateTime={item.due_at}>{date(item.due_at)}</time>}</li>)}</ul> : <p className="life-empty">Todavía no hay evidencias publicadas para este apartado.</p>}</section>
        {section === 'overview' && <RecordSection title="Actividad reciente" records={data.recent ?? []} empty="Todavía no hay actividad registrada en esta área."/>}
        {snapshots.some(snapshot => snapshot.payload.references?.length) && <section className="life-section"><h2>Fuentes</h2><ul className="life-sources">{snapshots.flatMap(snapshot => (snapshot.payload.references ?? []).map((reference, index) => { let href: string | undefined; try { const url = new URL(reference.url || ''); if (url.protocol === 'https:' && !url.username && !url.password) href = url.href; } catch {} return <li key={`${snapshot.source}:${index}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{reference.source}</a> : <span>{reference.source}</span>}{reference.external_id && <small>{reference.external_id}</small>}{reference.local_ref && <small>Original conservado en el homelab</small>}</li>; }))}</ul></section>}
      </>}
    </>}
    <p className="life-calendar"><a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noopener noreferrer">Abrir Google Calendar</a></p>
  </div>;
}
function RecordSection({ title, records, empty }: { title: string; records: RecordRow[]; empty: string }) {
  return <section className="life-section"><h2>{title}</h2>{records.length ? <ul className="life-list">{records.map(record => <li key={record.id}><div><h3>{record.title}</h3><p>{statusNames[record.status] || record.status}</p></div>{record.due_at && <time dateTime={record.due_at}>{date(record.due_at)}</time>}</li>)}</ul> : <p className="life-empty">{empty}</p>}</section>;
}
function FinanceSummary({ data }: { data?: DashboardData['finance'] }) {
  return <section className="life-section"><h2>Finanzas personales</h2>{data?.networth?.length ? <div className="life-finance">{data.networth.map(entry => <article key={entry.currency}><h3>Patrimonio en {entry.currency}</h3><p className="life-total">{amount(Number(entry.networth_minor), entry.currency)}</p><p>Activos {amount(Number(entry.assets_minor), entry.currency)} · Pasivos {amount(Number(entry.liabilities_minor), entry.currency)}</p><p>{entry.change_percent === null ? 'Sin comparación disponible' : `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2, signDisplay: 'always' }).format(entry.change_percent)} % respecto a ${date(entry.comparison_at)}`}</p><small>Valoraciones al {date(entry.as_of)}. Subtotales por moneda, sin conversión estimada.</small></article>)}</div> : <p className="life-empty">Aún no hay valoraciones de activos y deudas para calcular tu patrimonio. Los correos de movimientos no acreditan tu saldo total.</p>}{!!data?.by_currency?.length && <dl className="life-metrics">{data.by_currency.map(entry => <div key={entry.currency}><dt>Ingresos / gastos confirmados · {entry.currency}</dt><dd>{amount(Number(entry.income_minor), entry.currency)} / {amount(Number(entry.expense_minor) - Number(entry.refund_minor), entry.currency)}</dd><small>{entry.draft_count ? `${entry.draft_count} movimientos por revisar` : 'Sin borradores pendientes'}</small></div>)}</dl>}{!!data?.latest_transactions?.length && <><h3>Últimos movimientos</h3><ul className="life-list">{data.latest_transactions.map(entry => <li key={entry.id}><div><strong>{entry.merchant || entry.description || 'Movimiento'}</strong><p>{statusNames[entry.status] || entry.status} · {date(entry.occurred_at)}</p></div><span>{entry.amount_minor === null ? 'Importe por revisar' : amount(Number(entry.amount_minor), entry.currency)}</span></li>)}</ul></>}</section>;
}
function HealthSummary({ data }: { data?: DashboardData['gym'] }) {
  const weight = data?.last_bodyweight && typeof data.last_bodyweight === 'object' ? data.last_bodyweight as Record<string, unknown> : null;
  const training = data?.next_training && typeof data.next_training === 'object' ? data.next_training as Record<string, unknown> : null;
  const trainingDate = typeof training?.date === 'string' ? training.date : typeof training?.due_at === 'string' ? date(training.due_at) : '';
  const hasGymData = !!data && !!(Number(data.workout_count) || Number(data.routine_count) || Number(data.bodyweight_count) || training);
  return <section className="life-section"><h2>Tu entrenamiento</h2>{hasGymData ? <><dl className="life-metrics"><div><dt>Últimos 30 días</dt><dd>{data?.workouts_30_days ?? 0} entrenamientos</dd></div><div><dt>Entrenamientos registrados</dt><dd>{data?.workout_count ?? 0}</dd></div><div><dt>Rutinas</dt><dd>{data?.routine_count ?? 0}</dd></div><div><dt>Última sesión</dt><dd>{date(data?.last_workout_at)}</dd></div></dl>{weight && <p>Último peso registrado: {String(weight.value ?? 'Sin datos')} {String(weight.unit ?? '')}</p>}{training && <p>Próximo entrenamiento: {String(training.title ?? 'Consultar plan en el gimnasio')}{trainingDate ? ` · ${trainingDate}` : ''}</p>}</> : <p className="life-empty">Todavía no hay datos de entrenamiento sincronizados.</p>}<a className="life-gym-link" href="/gym/">Abrir gimnasio</a></section>;
}
