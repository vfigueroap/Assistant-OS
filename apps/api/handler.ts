import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { httpsUrl } from '../worker/src/config.js';
import { stampPut } from '../../vendor/opengym/api/sync-stamps.js';

const CHUNK_BYTES = 256 * 1024;
const INLINE_BYTES = 1024 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
const uuid = z.uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const stateInput = z.object({ state: z.record(z.string(), z.unknown()), baseRev: revision.default(null), baseWid: uuid.nullable().default(null), stamped: z.boolean().default(false) });
const snapshotInput = stateInput.omit({ state: true }).extend({ parts: z.number().int().min(1).max(32), bytes: z.number().int().min(1).max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });

export function publicConfig(env: NodeJS.ProcessEnv = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const supabasePublishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (!supabaseUrl && !supabasePublishableKey) return { configured: false, supabaseUrl: '', supabasePublishableKey: '' };
  if (!supabaseUrl || !supabasePublishableKey) throw new ApiError(503, 'La configuración de Supabase está incompleta.');
  httpsUrl(supabaseUrl, env.ALLOW_LOCAL_SUPABASE === 'true');
  if (!supabasePublishableKey.startsWith('sb_publishable_')) {
    try {
      if (JSON.parse(Buffer.from(supabasePublishableKey.split('.')[1]!, 'base64url').toString()).role !== 'anon') throw new Error();
    } catch { throw new ApiError(503, 'Usa una clave publicable de Supabase.'); }
  }
  return { configured: true, supabaseUrl, supabasePublishableKey };
}

async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'Se requiere JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Falta el cuerpo JSON.');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength;
      if (total > INLINE_BYTES + 65536) throw new ApiError(413, 'Usa el transporte por partes para perfiles grandes.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'JSON inválido.'); }
}

async function result<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && /^Gym state (?:must be an object below|exceeds)/.test(error.message)) throw new ApiError(413, 'El perfil supera el límite de almacenamiento, incluidos los metadatos. No se modificaron tus entrenamientos.');
  if (error) throw new ApiError(502, 'No se pudo guardar o consultar el gimnasio.');
  return data;
}

async function saveState(client: SupabaseClient, input: z.infer<typeof stateInput>) {
  const current = await result(client.rpc('get_gym_state'));
  if (current.rev !== input.baseRev || current.wid !== input.baseWid) return { ...current, conflict: true };
  const next = structuredClone(input.state);
  if (Number(current.state?.resetAt || 0) > Number(next.resetAt || 0)) {
    next.resetAt = current.state.resetAt;
    if (current.state.resetIds) next.resetIds = current.state.resetIds;
    else delete next.resetIds;
  }
  stampPut(current.state, next, { overRead: true, stamped: input.stamped, now: Date.now() });
  return result(client.rpc('put_gym_state', { p_state: next, p_base_rev: input.baseRev, p_base_wid: input.baseWid, p_stamped: true }));
}

async function transfer(client: SupabaseClient, owner: string, value: Record<string, unknown>, status = 200) {
  if (!value.state) return json(value, status);
  const bytes = Buffer.from(JSON.stringify(value.state));
  if (bytes.length <= INLINE_BYTES) return json(value, status);
  if (bytes.length > MAX_BYTES) throw new ApiError(413, 'El perfil supera 8 MiB.');
  const id = crypto.randomUUID(); const parts = Math.ceil(bytes.length / CHUNK_BYTES);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await result(client.from('gym_snapshots').delete().eq('owner_id', owner).lt('expires_at', new Date().toISOString()));
  await result(client.from('gym_snapshots').insert({ id, owner_id: owner, purpose: 'download', parts, bytes: bytes.length, sha256, state_rev: value.rev, state_wid: value.wid }));
  const chunks = Array.from({ length: parts }, (_, index) => ({ snapshot_id: id, owner_id: owner, index, data: bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString('base64') }));
  await result(client.from('gym_snapshot_chunks').insert(chunks));
  const { state: ignored, ...metadata } = value;
  return json({ ...metadata, snapshot: { id, parts, bytes: bytes.length, sha256, chunkBytes: CHUNK_BYTES } }, status);
}

export async function handleRequest(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  try {
    const url = new URL(request.url); const method = request.method;
    if (url.pathname === '/api/health' && method === 'GET') return json({ application: 'personal-os', status: 'ok', cloudConfigured: publicConfig(env).configured });
    if (url.pathname === '/api/config' && method === 'GET') return json(publicConfig(env));
    if (url.pathname === '/gym/api/config' && method === 'GET') return json({ allow_guest: false, registration: false, media: false, default_lang: 'es', coach: null, integrations: { providers: [] } });
    if (!url.pathname.startsWith('/gym/api/')) return json({ error: 'Ruta no encontrada.' }, 404);
    const config = publicConfig(env);
    if (!config.configured) throw new ApiError(503, 'Configura Supabase para sincronizar el gimnasio.');
    const authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer \S+$/i.test(authorization)) throw new ApiError(401, 'Inicia sesión desde el portal.');
    if (!['GET', 'HEAD'].includes(method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== (env.APP_ORIGIN || url.origin)) throw new ApiError(403, 'Origen no autorizado.');
    }
    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: authorization }, fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) }) },
    });
    const authenticated = await client.auth.getUser(authorization.slice(7));
    if (authenticated.error || !authenticated.data.user) throw new ApiError(401, 'La sesión expiró. Inicia sesión desde el portal.');
    if (!await result(client.rpc('is_workspace_owner'))) throw new ApiError(403, 'La cuenta no es propietaria de este espacio.');
    const owner = authenticated.data.user.id;
    if (url.pathname === '/gym/api/me' && method === 'GET') return json({ user: { id: owner, name: authenticated.data.user.email?.split('@')[0] || 'Mi cuenta', admin: false } });
    if (url.pathname === '/gym/api/activity' && method === 'POST') {
      z.object({ active: z.boolean() }).passthrough().parse(await body(request));
      return json({ ok: true }); // Single-owner portal has no shared presence list to persist.
    }
    if (url.pathname === '/gym/api/data/rev' && method === 'GET') {
      const value = await result(client.rpc('get_gym_state'));
      return json({ rev: value.rev, wid: value.wid });
    }
    if (url.pathname === '/gym/api/data' && method === 'GET') return transfer(client, owner, await result(client.rpc('get_gym_state')));
    if (url.pathname === '/gym/api/data' && method === 'PUT') {
      const input = stateInput.parse(await body(request));
      const value = await saveState(client, input);
      return transfer(client, owner, value, value.conflict ? 409 : 200);
    }
    if (url.pathname === '/gym/api/snapshots' && method === 'POST') {
      const input = snapshotInput.parse(await body(request));
      if (input.parts !== Math.ceil(input.bytes / CHUNK_BYTES)) throw new ApiError(400, 'Número de partes inválido.');
      await result(client.from('gym_snapshots').delete().eq('owner_id', owner).lt('expires_at', new Date().toISOString()));
      const id = crypto.randomUUID();
      await result(client.from('gym_snapshots').insert({ id, owner_id: owner, purpose: 'upload', parts: input.parts, bytes: input.bytes, sha256: input.sha256, base_rev: input.baseRev, base_wid: input.baseWid, stamped: input.stamped }));
      return json({ uploadId: id });
    }
    const route = /^\/gym\/api\/snapshots\/([^/]+)\/(?:chunks\/(\d+)|(commit))$/.exec(url.pathname);
    if (!route) return json({ error: 'Ruta no encontrada.' }, 404);
    const id = uuid.parse(route[1]);
    const snapshot = await result(client.from('gym_snapshots').select('*').eq('id', id).eq('owner_id', owner).gt('expires_at', new Date().toISOString()).maybeSingle());
    if (!snapshot) throw new ApiError(404, 'La transferencia expiró. Vuelve a sincronizar.');
    if (route[2] !== undefined) {
      const index = Number(route[2]);
      if (!Number.isSafeInteger(index) || index < 0 || index >= snapshot.parts) throw new ApiError(400, 'Parte inválida.');
      if (method === 'GET') {
        if (snapshot.purpose !== 'download') throw new ApiError(400, 'La transferencia no es de descarga.');
        const chunk = await result(client.from('gym_snapshot_chunks').select('index,data').eq('snapshot_id', id).eq('owner_id', owner).eq('index', index).maybeSingle());
        if (!chunk) throw new ApiError(404, 'Parte no encontrada.');
        return json(chunk);
      }
      if (method === 'PUT') {
        if (snapshot.purpose !== 'upload' || snapshot.committed) throw new ApiError(409, 'La transferencia ya fue cerrada.');
        const input = z.object({ data: z.string().max(349528).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).parse(await body(request));
        if (Buffer.from(input.data, 'base64').length !== Math.min(CHUNK_BYTES, snapshot.bytes - index * CHUNK_BYTES)) throw new ApiError(400, 'Tamaño de parte inválido.');
        await result(client.from('gym_snapshot_chunks').upsert({ snapshot_id: id, owner_id: owner, index, data: input.data }));
        return json({ ok: true });
      }
    }
    if (route[3] && method === 'POST') {
      if (snapshot.purpose !== 'upload' || snapshot.committed) throw new ApiError(409, 'La transferencia ya fue cerrada.');
      const chunks = await result(client.from('gym_snapshot_chunks').select('index,data').eq('snapshot_id', id).eq('owner_id', owner).order('index'));
      if (!chunks || chunks.length !== snapshot.parts || chunks.some((chunk, index) => chunk.index !== index)) throw new ApiError(409, 'Faltan partes. No se modificó el perfil.');
      const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data, 'base64')));
      if (bytes.length !== snapshot.bytes || createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) throw new ApiError(400, 'La transferencia no supera la verificación de integridad.');
      let state: unknown;
      try { state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ApiError(400, 'Perfil JSON inválido.'); }
      const input = stateInput.parse({ state, baseRev: snapshot.base_rev, baseWid: snapshot.base_wid, stamped: snapshot.stamped });
      const value = await saveState(client, input);
      if (!value.conflict) await result(client.from('gym_snapshots').update({ committed: true }).eq('id', id).eq('owner_id', owner));
      return transfer(client, owner, value, value.conflict ? 409 : 200);
    }
    return json({ error: 'Método no permitido.' }, 405);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'Los datos enviados no son válidos.' }, 400);
    return json({ error: 'No se pudo completar la solicitud. Revisa la configuración y la conexión.' }, 503);
  }
}
