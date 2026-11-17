import { expect, test, type Page } from '@playwright/test';

const cloudOrigin = 'https://supabase.example.org';
const ownerId = '11111111-1111-4111-8111-111111111111';
type CloudRecord = { id: string; owner_id: string; kind: string; title: string; status: string; due_at: string | null; data: Record<string, unknown>; created_at: string; updated_at: string; deleted_at: string | null };

async function cloud(page: Page, owner = true) {
  const state = { records: [] as CloudRecord[], loggedIn: false, logoutCount: 0, unexpected: [] as string[], pageErrors: [] as string[] };
  const user = { id: ownerId, aud: 'authenticated', role: 'authenticated', email: 'owner@example.org', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  page.on('pageerror', error => state.pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:5173') {
      if (url.pathname === '/api/config') return route.fulfill({ json: { configured: true, supabaseUrl: cloudOrigin, supabasePublishableKey: 'sb_publishable_test_fixture' } });
      return route.continue();
    }
    if (url.origin !== cloudOrigin) { state.unexpected.push(request.url()); return route.abort(); }
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      if (request.postDataJSON().password !== 'fixture-password') return route.fulfill({ status: 400, json: { code: 'invalid_credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' } });
      state.loggedIn = true;
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(JSON.stringify({ sub: ownerId, aud: 'authenticated', role: 'authenticated', exp: expiresAt })).toString('base64url');
      return route.fulfill({ json: { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: 'fixture-refresh', user } });
    }
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') return route.fulfill({ json: user });
    if (url.pathname === '/auth/v1/logout' && request.method() === 'POST') { state.loggedIn = false; state.logoutCount++; return route.fulfill({ status: 204 }); }
    if (url.pathname === '/rest/v1/rpc/is_workspace_owner') return route.fulfill({ json: owner });
    if (url.pathname === '/rest/v1/records') {
      if (!state.loggedIn || !owner) return route.fulfill({ status: 403, json: { code: '42501', message: 'Forbidden in fixture' } });
      if (request.method() === 'GET') {
        const available = state.records.filter(record => url.searchParams.get('deleted_at') !== 'is.null' || record.deleted_at === null);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        return route.fulfill({ json: available.slice(offset, offset + limit) });
      }
      if (request.method() === 'POST') {
        const now = new Date().toISOString();
        const record: CloudRecord = { id: crypto.randomUUID(), owner_id: ownerId, kind: 'task', title: '', status: 'active', due_at: null, data: {}, created_at: now, updated_at: now, deleted_at: null, ...request.postDataJSON() };
        state.records.unshift(record);
        return route.fulfill({ status: 201, json: record });
      }
      if (request.method() === 'PATCH') {
        const record = state.records.find(value => `eq.${value.id}` === url.searchParams.get('id') && `eq.${value.updated_at}` === url.searchParams.get('updated_at'));
        if (!record) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'No rows matched the expected revision' } });
        Object.assign(record, request.postDataJSON(), { updated_at: new Date(Date.parse(record.updated_at) + 1).toISOString() });
        return route.fulfill({ json: record });
      }
    }
    state.unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  return state;
}

async function login(page: Page, password = 'fixture-password') {
  await page.getByLabel('Correo', { exact: true }).fill('owner@example.org');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
}

test('cargar más permite exportar todos los registros de la cuenta', async ({ page }) => {
  const state = await cloud(page);
  const now = new Date().toISOString();
  state.records = Array.from({ length: 101 }, (_, index) => ({ id: crypto.randomUUID(), owner_id: ownerId, kind: 'note', title: `Registro ${index + 1}`, status: 'active', due_at: null, data: {}, created_at: now, updated_at: now, deleted_at: null }));
  await page.goto('/login?returnTo=/records');
  await login(page);
  await expect(page.getByRole('button', { name: 'Carga todo para exportar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cargar más registros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registro 101', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar copia', exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toHaveLength(101);
  expect(state.unexpected).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test('login inválido permite corregir, el propietario entra y puede cerrar la sesión', async ({ page }) => {
  const state = await cloud(page);
  await page.goto('/login?returnTo=/records');
  await login(page, 'incorrecta');
  await expect(page.getByRole('alert')).toContainText('No se pudo iniciar sesión');
  await login(page);
  await expect(page).toHaveURL('http://127.0.0.1:5173/records');
  await expect(page.getByRole('heading', { name: 'Anotar algo', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Conexión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sesión iniciada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar a tu espacio', exact: true })).toBeVisible();
  expect(state.logoutCount).toBe(1);
  expect(state.unexpected).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

for (const entry of ['/login', '/']) test(`una cuenta sin propiedad se desconecta y no obtiene el editor desde ${entry}`, async ({ page }) => {
  const state = await cloud(page, false);
  await page.goto(entry);
  if (entry === '/') await page.getByRole('link', { name: 'Entrar a mi espacio', exact: true }).click();
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Esta cuenta no es la propietaria');
  await expect(page.getByRole('heading', { name: 'Entrar a tu espacio', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anotar algo', exact: true })).toHaveCount(0);
  expect(state.loggedIn).toBe(false);
  expect(state.logoutCount).toBe(1);
  expect(state.unexpected).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test('registros en nube se editan y restauran tras recargar, sin pisar una revisión ajena', async ({ page }) => {
  const state = await cloud(page);
  await page.goto('/login?returnTo=/records');
  await login(page);
  await expect(page.getByRole('heading', { name: 'Anotar algo', exact: true })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Registro en nube');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registro en nube', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Registro en nube', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Registro editado');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await page.getByRole('button', { name: 'Completar Registro editado', exact: true }).click();
  await expect(page.getByText('Tarea · Completado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archivar Registro editado', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archivar Registro editado', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByText('Archivados', { exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar Registro editado', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registro editado', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Registro editado', exact: true }).click();
  state.records[0].title = 'Cambio desde otro cliente';
  state.records[0].updated_at = new Date(Date.parse(state.records[0].updated_at) + 1).toISOString();
  await page.getByLabel('Título', { exact: true }).fill('No sobrescribir');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar');
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('No sobrescribir');
  expect(state.records[0].title).toBe('Cambio desde otro cliente');
  await page.getByRole('button', { name: 'Cancelar edición', exact: true }).click();
  await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cambio desde otro cliente', exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});
