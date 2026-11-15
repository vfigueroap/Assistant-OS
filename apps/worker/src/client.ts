import { createClient } from '@supabase/supabase-js';
import type { WorkerConfig } from './config.js';
import { StateStore } from './state.js';

export async function workerClient(config: WorkerConfig, state: StateStore) {
  const client = createClient(config.supabaseUrl, config.publishableKey, { auth: { storage: state.authStorage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const current = await client.auth.getSession();
  if (!current.data.session) {
    if (!config.email || !config.password) throw new Error('Dedicated worker credentials required for initial sign-in');
    const result = await client.auth.signInWithPassword({ email: config.email, password: config.password });
    if (result.error) throw new Error('worker_authentication_failed');
  }
  if ((await client.auth.getUser()).error) throw new Error('worker_session_invalid');
  return client;
}
export type WorkerClient = Awaited<ReturnType<typeof workerClient>>;
export async function rpc<T>(client: WorkerClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(`rpc_${name}_failed`);
  return result.data as T;
}
