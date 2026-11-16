import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { httpsUrl, secret } from '../apps/worker/src/config.js';
import { jobKinds } from '../packages/domain/src/jobs.js';

export async function setup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.SUPABASE_URL;
  const key = await secret('SUPABASE_SECRET_KEY');
  const ownerId = z.uuid().safeParse(process.env.SETUP_OWNER_ID);
  if (!url || !key || !ownerId.success) throw new Error('Configura SUPABASE_URL, SUPABASE_SECRET_KEY y SETUP_OWNER_ID (UUID de un usuario Auth existente). Aplica las migraciones antes de ejecutar setup.');
  httpsUrl(url, process.env.ALLOW_LOCAL_SUPABASE === 'true');
  const workerId = process.env.SETUP_WORKER_ID ? z.uuid().parse(process.env.SETUP_WORKER_ID) : undefined;
  const scopes = z.array(z.enum(jobKinds)).min(1).parse((process.env.SETUP_WORKER_SCOPES || 'document.extract,finance.extract,planner.week,fitness.sync,life.organize,projects.sync').split(',').map(value => value.trim()));
  if (workerId === ownerId.data) throw new Error('El worker necesita un usuario Auth distinto del propietario.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await client.rpc('bootstrap_owner', { p_owner_id: ownerId.data });
  if (owner.error) throw new Error('No se pudo registrar al propietario. Revisa las migraciones, el usuario Auth y la clave de servidor.');
  if (workerId) {
    const worker = await client.rpc('register_worker', { p_worker_user_id: workerId, p_scopes: scopes, p_label: 'Personal OS worker' });
    if (worker.error) throw new Error('Propietario registrado; no se pudo registrar el worker. Revisa su usuario y scopes.');
  }
  console.log(`Propietario configurado. Worker: ${workerId ? 'registrado' : 'no solicitado'}. No se crearon cuentas ni se activó ejecución automática.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void setup().catch(error => { console.error(error instanceof Error ? error.message : 'No se pudo completar setup.'); process.exitCode = 1; });
