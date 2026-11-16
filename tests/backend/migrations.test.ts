import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const owner = 'ed5a6955-3dc2-4441-a9b3-f050e22a5b16';
const stranger = 'faa6b4c3-f81a-4c8f-a339-7c1f4b2884d2';
const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    -- Supabase provides this platform hook; PGlite only needs its signature for REVOKE.
    create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end; $$;
    -- PGlite cannot run pg_cron; retain the migration call without scheduling a background job.
    create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to public;
    grant execute on function auth.uid() to public;
    create domain extensions.vector as real[];
    insert into auth.users(id) values('${owner}'),('${stranger}');
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const filename of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(filename, directory), 'utf8');
    // These tests exercise SQL/RLS, not platform extensions or cron execution.
    await db.exec(sql.replace('create extension if not exists vector with schema extensions;', '').replace('create extension if not exists pg_cron;', ''));
  }
  await db.query('select public.bootstrap_owner($1)', [owner]);
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
});
afterAll(async () => { await db.close(); });

it('accepts the browser chunk size, keeps CAS writes atomic and denies foreign owners', async () => {
  const current = await db.query<{ state: { rev: number; wid: string } }>('select public.get_gym_state() as state');
  const base = current.rows[0]!.state;
  const value = { note: 'x'.repeat(5_300_000), workouts: [{ id: 'preserved' }], active: { local: true } };
  const saved = await db.query<{ result: { ok: boolean; rev: number } }>('select public.put_gym_state($1::jsonb,$2,$3,true) as result', [JSON.stringify(value), base.rev, base.wid]);
  expect(saved.rows[0]!.result).toMatchObject({ ok: true, rev: 1 });
  const stale = await db.query<{ result: { conflict: boolean; state: unknown } }>('select public.put_gym_state($1::jsonb,$2,$3,true) as result', ['{}', base.rev, base.wid]);
  expect(stale.rows[0]!.result.conflict).toBe(true);
  expect(stale.rows[0]!.result.state).toMatchObject({ note: value.note, workouts: value.workouts, _rev: 1, _wid: expect.any(String), _wids: [] });
  expect(stale.rows[0]!.result.state).not.toHaveProperty('active');
  const id = '5a3017fe-2e43-4d18-8df9-281557865ce7';
  await db.query(`insert into public.gym_snapshots(id,owner_id,purpose,parts,bytes,sha256) values($1,$2,'upload',32,8388608,$3)`, [id, owner, 'a'.repeat(64)]);
  await db.query('insert into public.gym_snapshot_chunks(snapshot_id,owner_id,index,data) values($1,$2,0,$3)', [id, owner, 'A'.repeat(349528)]);
  await expect(db.query('insert into public.gym_snapshot_chunks(snapshot_id,owner_id,index,data) values($1,$2,1,$3)', [id, owner, 'A'.repeat(349529)])).rejects.toThrow();
  await db.exec(`set request.jwt.claim.sub='${stranger}';`);
  expect((await db.query('select * from public.gym_state')).rows).toHaveLength(0);
  expect((await db.query('select * from public.gym_snapshot_chunks')).rows).toHaveLength(0);
  await expect(db.query('select public.get_gym_state()')).rejects.toThrow('Workspace owner authorization required');
  await db.exec(`set request.jwt.claim.sub='${owner}';`);
  await db.exec('delete from public.gym_snapshots');
  expect((await db.query('select id from public.gym_snapshots')).rows).toHaveLength(1);
  await db.query(`update public.gym_snapshots set expires_at=now()-interval '1 second' where id=$1`, [id]);
  await db.exec('delete from public.gym_snapshots');
  expect((await db.query('select id from public.gym_snapshots')).rows).toHaveLength(0);
  expect((await db.query('select * from public.gym_snapshot_chunks')).rows).toHaveLength(0);
});

it('preserves revision history and rejects oversized JSONB without changing saved data', async () => {
  await db.exec(`set request.jwt.claim.sub='${owner}';`);
  const { rows } = await db.query<{ state: { rev: number; wid: string } }>('select public.get_gym_state() as state');
  const base = rows[0]!.state;
  const state = { note: 'with spaces and "quoted" text', workouts: [{ id: 'kept' }] };
  const response = await db.query<{ result: { ok: boolean; rev: number; wid: string } }>('select public.put_gym_state($1::jsonb,$2,$3,true) as result', [JSON.stringify(state), base.rev, base.wid]);
  expect(response.rows[0]!.result.ok).toBe(true);
  const saved = response.rows[0]!.result;
  const oversized = { entries: Array.from({ length: 10000 }, () => 0), note: '' };
  oversized.note = 'x'.repeat(8388608 - Buffer.byteLength(JSON.stringify(oversized)));
  expect(Buffer.byteLength(JSON.stringify(oversized))).toBe(8388608);
  await expect(db.query('select public.put_gym_state($1::jsonb,$2,$3,true)', [JSON.stringify(oversized), saved.rev, saved.wid])).rejects.toThrow('Gym state must be an object below 8 MB');
  const current = await db.query<{ result: { state: unknown; rev: number; wid: string } }>('select public.get_gym_state() as result');
  expect(current.rows[0]!.result).toMatchObject({ rev: saved.rev, wid: saved.wid, state: { ...state, _rev: saved.rev, _wid: saved.wid, _wids: [base.wid] } });
});
