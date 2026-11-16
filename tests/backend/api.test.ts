import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { handleRequest, publicConfig } from '../../apps/api/handler.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const owner = 'ed5a6955-3dc2-4441-a9b3-f050e22a5b16';
const wid = 'afd76a86-d282-4c31-8a7b-0d1021c3c5a1';
const id = '5a3017fe-2e43-4d18-8df9-281557865ce7';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const rpc = vi.fn();
const from = vi.fn();
const getUser = vi.fn();
const request = (path: string, method = 'GET', data?: unknown, headers?: Record<string, string>) => new Request('http://localhost:5173' + path, { method, headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json', ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
function query(data: unknown) {
  const chain: Record<string, any> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
  for (const method of ['select', 'eq', 'gt', 'lt', 'maybeSingle', 'insert', 'upsert', 'update', 'delete', 'order']) chain[method] = vi.fn(() => chain);
  return chain;
}

beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: owner, email: 'owner@example.invalid' } }, error: null });
  rpc.mockImplementation(async (name: string) => ({ data: name === 'is_workspace_owner' ? true : {}, error: null }));
  vi.mocked(createClient).mockReturnValue({ auth: { getUser }, rpc, from } as any);
});

describe('public configuration and ownership', () => {
  it('starts unconfigured and never exposes server credentials', async () => {
    expect(publicConfig({})).toEqual({ configured: false, supabaseUrl: '', supabasePublishableKey: '' });
    expect(publicConfig({ ...env, SUPABASE_SECRET_KEY: 'keep-private' })).toEqual({ configured: true, supabaseUrl: env.SUPABASE_URL, supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY });
    expect(await (await handleRequest(request('/api/config'), {})).json()).toEqual(publicConfig({}));
    expect((await handleRequest(request('/gym/api/me'), {})).status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('refuses secret and legacy service role keys', async () => {
    for (const key of ['sb_secret_do-not-expose', 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x']) {
      const response = await handleRequest(request('/api/config'), { ...env, SUPABASE_PUBLISHABLE_KEY: key });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(key);
    }
  });
  it('requires remote session validation and workspace ownership', async () => {
    expect((await handleRequest(new Request('http://localhost/gym/api/me'), env)).status).toBe(401);
    getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('revoked') });
    expect((await handleRequest(request('/gym/api/me'), env)).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await handleRequest(request('/gym/api/me'), env)).status).toBe(403);
    const response = await handleRequest(request('/gym/api/me'), env);
    expect((await response.json()).user.id).toBe(owner);
    expect(getUser).toHaveBeenLastCalledWith('verified-token');
    expect(rpc).toHaveBeenCalledWith('is_workspace_owner');
  });
  it('refuses cross-origin mutations before reaching auth or the database', async () => {
    const response = await handleRequest(request('/gym/api/data', 'PUT', { state: {} }, { origin: 'https://foreign.invalid' }), env);
    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('gym data integrity', () => {
  it('reports the cloud storage limit without replacing the profile', async () => {
    rpc.mockImplementation(async (name: string) => name === 'put_gym_state' ? { data: null, error: { code: 'P0001', message: 'Gym state exceeds 8 MB after bookkeeping' } } : { data: name === 'is_workspace_owner' ? true : { state: {}, rev: 1, wid }, error: null });
    const response = await handleRequest(request('/gym/api/data', 'PUT', { state: {}, baseRev: 1, baseWid: wid }), env);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('No se modificaron');
  });
  it('preserves the server state and returns 409 when the base revision changed', async () => {
    const original = { workouts: [{ id: 'saved-workout' }] };
    rpc.mockImplementation(async (name: string) => ({ data: name === 'is_workspace_owner' ? true : { conflict: true, state: original, rev: 2, wid }, error: null }));
    const response = await handleRequest(request('/gym/api/data', 'PUT', { state: { workouts: [] }, baseRev: 1, baseWid: wid, stamped: true }), env);
    expect(response.status).toBe(409);
    expect((await response.json()).state).toEqual(original);
    expect(rpc.mock.calls.some(([name]) => name === 'put_gym_state')).toBe(false);
  });
  it('keeps resets and stamps legacy changes before an atomic write', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      for (const resetIds of [undefined, { workouts: ['already-reset'] }]) {
        const current = { resetAt: 100, ...(resetIds ? { resetIds } : {}), restSec: 90, workouts: [{ id: 'w1', d: '2026-11-16', start: 1, end: 2 }], routines: [], deleted: { workouts: { w9: 50 } }, edited: { restSec: 50 } };
        const before = structuredClone(current);
        rpc.mockImplementation(async (name: string) => ({ data: name === 'is_workspace_owner' ? true : name === 'get_gym_state' ? { state: current, rev: 1, wid } : { ok: true, rev: 2, wid }, error: null }));
        const response = await handleRequest(request('/gym/api/data', 'PUT', { state: { resetAt: 50, resetIds: { workouts: ['stale'] }, restSec: 120, workouts: [], routines: [] }, baseRev: 1, baseWid: wid }), env);
        expect(response.status).toBe(200);
        const saved = rpc.mock.calls.filter(([name]) => name === 'put_gym_state').at(-1)![1];
        expect(saved).toMatchObject({ p_base_rev: 1, p_base_wid: wid, p_stamped: true });
        expect(saved.p_state.resetAt).toBe(100);
        expect(saved.p_state.resetIds).toEqual(resetIds);
        expect(saved.p_state.deleted.workouts.w9).toBe(50);
        expect(saved.p_state.deleted.workouts.w1).toBeGreaterThanOrEqual(Date.now());
        expect(saved.p_state.edited.restSec).toBeGreaterThanOrEqual(Date.now());
        expect(current).toEqual(before);
      }
    } finally { clock.mockRestore(); }
  });
  it('preserves an intentional newer reset and client-owned stamps', async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === 'is_workspace_owner' ? true : name === 'get_gym_state' ? { state: { resetAt: 100, resetIds: { workouts: ['old'] }, deleted: { workouts: { old: 80 } } }, rev: 1, wid } : { ok: true, rev: 2, wid }, error: null }));
    const state = { resetAt: 200, resetIds: { workouts: ['new'] }, workouts: [], routines: [], edited: { restSec: 201 } };
    expect((await handleRequest(request('/gym/api/data', 'PUT', { state, baseRev: 1, baseWid: wid, stamped: true }), env)).status).toBe(200);
    const saved = rpc.mock.calls.find(([name]) => name === 'put_gym_state')![1].p_state;
    expect(saved.resetAt).toBe(200);
    expect(saved.resetIds).toEqual(state.resetIds);
    expect(saved.edited.restSec).toBe(201);
    expect(saved.deleted).toBeUndefined();
  });
  it('returns a database CAS conflict if another device writes after the pre-read', async () => {
    const phone = { workouts: [{ id: 'phone-write' }] };
    rpc.mockImplementation(async (name: string) => ({ data: name === 'is_workspace_owner' ? true : name === 'get_gym_state' ? { state: {}, rev: 1, wid } : { conflict: true, state: phone, rev: 2, wid }, error: null }));
    const response = await handleRequest(request('/gym/api/data', 'PUT', { state: { workouts: [] }, baseRev: 1, baseWid: wid, stamped: true }), env);
    expect(response.status).toBe(409);
    expect((await response.json()).state).toEqual(phone);
    expect(rpc.mock.calls.filter(([name]) => name === 'put_gym_state')).toHaveLength(1);
  });
  it('rejects invalid state and oversized inline requests before a write', async () => {
    expect((await handleRequest(request('/gym/api/data', 'PUT', { state: [] }), env)).status).toBe(400);
    expect((await handleRequest(request('/gym/api/data', 'PUT', { state: { text: 'x'.repeat(1_200_000) } }), env)).status).toBe(413);
    expect(rpc.mock.calls.every(([name]) => name === 'is_workspace_owner')).toBe(true);
  });
  it('refuses inconsistent manifests and incomplete snapshot commits', async () => {
    expect((await handleRequest(request('/gym/api/snapshots', 'POST', { parts: 1, bytes: 300000, sha256: 'a'.repeat(64) }), env)).status).toBe(400);
    const snapshot = { id, purpose: 'upload', parts: 2, bytes: 300000, sha256: 'a'.repeat(64), base_rev: 0, base_wid: wid, stamped: true };
    from.mockReturnValueOnce(query(snapshot)).mockReturnValueOnce(query([{ index: 0, data: 'e30=' }]));
    const response = await handleRequest(request(`/gym/api/snapshots/${id}/commit`, 'POST', {}), env);
    expect(response.status).toBe(409);
    expect(rpc.mock.calls.every(([name]) => name === 'is_workspace_owner')).toBe(true);
  });
  it('verifies SHA256 before committing a snapshot', async () => {
    const state = { workouts: [{ id: 'phone' }], note: 'á'.repeat(600000) };
    const bytes = Buffer.from(JSON.stringify(state));
    const chunks = Array.from({ length: Math.ceil(bytes.length / 262144) }, (_, index) => ({ index, data: bytes.subarray(index * 262144, (index + 1) * 262144).toString('base64') }));
    const snapshot = { id, purpose: 'upload', parts: chunks.length, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base_rev: 7, base_wid: wid, stamped: true };
    from.mockReturnValueOnce(query({ ...snapshot, sha256: '0'.repeat(64) })).mockReturnValueOnce(query(chunks));
    expect((await handleRequest(request(`/gym/api/snapshots/${id}/commit`, 'POST', {}), env)).status).toBe(400);
    expect(rpc.mock.calls.every(([name]) => name === 'is_workspace_owner')).toBe(true);
    from.mockReturnValueOnce(query(snapshot)).mockReturnValueOnce(query(chunks)).mockReturnValueOnce(query(null));
    rpc.mockImplementation(async (name: string) => ({ data: name === 'is_workspace_owner' ? true : name === 'get_gym_state' ? { state: { ...state, resetAt: 900, resetIds: { workouts: ['old'] } }, rev: 7, wid } : { ok: true, rev: 8, wid }, error: null }));
    expect((await handleRequest(request(`/gym/api/snapshots/${id}/commit`, 'POST', {}), env)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('put_gym_state', { p_state: expect.objectContaining({ ...state, resetAt: 900, resetIds: { workouts: ['old'] } }), p_base_rev: 7, p_base_wid: wid, p_stamped: true });
  });
});
