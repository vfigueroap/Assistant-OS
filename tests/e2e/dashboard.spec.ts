import { expect, test, type Page } from '@playwright/test';

const cloudOrigin = 'https://dashboard.example.org';
const ownerId = '11111111-1111-4111-8111-111111111111';
const lifeAreas = [['work', 'Trabajo'], ['health', 'Salud'], ['spirituality', 'Espiritualidad'], ['romantic', 'Pareja'], ['family-friends', 'Familia y amigos'], ['five-buckets', 'Cinco baldes'], ['system', 'Sistema'], ['business', 'Negocios'], ['education', 'Educación']] as const;
type DashboardRow = Record<string, unknown>;

async function dashboardFixture(page: Page) {
  const user = { id: ownerId, aud: 'authenticated', role: 'authenticated', email: 'owner@example.org', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: ownerId, aud: 'authenticated', role: 'authenticated', exp: expiresAt })).toString('base64url')}.fixture`;
  await page.addInitScript(session => { localStorage.setItem('assistant-os-auth', JSON.stringify(session)); localStorage.setItem('gym_tour_v1', JSON.stringify({ done: true })); }, { access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user });
  const state = { fail: false, reads: 0, errors: [] as string[], unexpected: [] as string[], data: { generated_at: new Date().toISOString(), counts: { records: 0 }, recent: [] as DashboardRow[], current: [] as DashboardRow[], upcoming: [] as DashboardRow[], snapshots: [] as DashboardRow[], finance: { by_currency: [], latest_transactions: [], networth: [] as DashboardRow[] }, gym: { workout_count: 0, routine_count: 0, bodyweight_count: 0, workouts_30_days: 0, last_workout_at: null, last_bodyweight: null, next_training: null as { title: string; date?: string; due_at?: string } | null } } };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.routeWebSocket('**/realtime/v1/websocket*', socket => { socket.onMessage(raw => { const value = JSON.parse(String(raw)); if (value.event === 'phx_join') socket.send(JSON.stringify({ event: 'phx_reply', ref: value.ref, topic: value.topic, payload: { status: 'ok', response: { postgres_changes: [] } } })); }); });
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:5173') {
      if (url.pathname === '/api/config') return route.fulfill({ json: { configured: true, supabaseUrl: cloudOrigin, supabasePublishableKey: 'sb_publishable_dashboard_fixture' } });
      if (url.pathname === '/gym/api/config') return route.fulfill({ json: { allow_guest: false, default_lang: 'es', registration: false, media: false, coach: null, integrations: { providers: [] } } });
      if (url.pathname === '/gym/api/me') return route.fulfill({ json: { user: { id: ownerId, name: 'Propietario de prueba', admin: false } } });
      if (url.pathname === '/gym/api/data/rev') return route.fulfill({ json: { rev: 1, wid: ownerId } });
      if (url.pathname === '/gym/api/data') return route.fulfill({ json: { state: { routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, unit: 'kg', lang: 'es', _ts: 1 }, rev: 1, wid: ownerId } });
      if (url.pathname === '/gym/api/activity') return route.fulfill({ json: { ok: true } });
      return route.continue();
    }
    if (url.origin !== cloudOrigin) { state.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort(); }
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/rpc/is_workspace_owner') return route.fulfill({ json: true });
    if (url.pathname === '/rest/v1/rpc/get_dashboard') { state.reads++; const area = request.postDataJSON()?.p_area; return route.fulfill(state.fail ? { status: 503, json: { message: 'Fixture temporalmente desconectado' } } : { json: { ...state.data, area, snapshots: state.data.snapshots.filter(snapshot => !area || snapshot.area === area) } }); }
    if (url.pathname === '/rest/v1/rpc/get_workspace_settings') return route.fulfill({ json: { paused: true } });
    if (url.pathname === '/rest/v1/rpc/ui_worker_status') return route.fulfill({ json: { online: false } });
    if (url.pathname === '/rest/v1/gym_profiles') return route.fulfill({ json: { workout_count: 0 } });
    if (/^\/rest\/v1\/(records|transactions|documents|financial_evidence|jobs|actions|fragments|budgets|schedules)$/.test(url.pathname)) return route.fulfill({ json: [] });
    state.unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
  });
  return state;
}

test('las nueve áreas abren y el panel se cierra, con teclado y ambos temas', async ({ page }) => {
  const state = await dashboardFixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  for (const [id, label] of lifeAreas) {
    await page.getByRole('button', { name: 'Abrir áreas', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Áreas de mi vida' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Áreas principales' }).getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/areas/${id}/overview$`));
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /^Tema / }).click();
      await page.getByRole('button', { name: 'Abrir áreas' }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Abrir áreas' })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/dashboard-${width}-${theme}.png`, fullPage: true });
    }
  }
  await page.getByRole('link', { name: 'Personal OS', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5173/');
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('el gimnasio autenticado conserva salida al inicio y cambio de área en sus pantallas', async ({ page }) => {
  const state = await dashboardFixture(page);
  await page.goto('/gym/#/home');
  await expect(page.getByRole('link', { name: 'Personal OS', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accede al gimnasio', exact: true })).toHaveCount(0);
  for (const path of ['home', 'plan', 'stats', 'settings']) {
    await page.goto(`/gym/#/${path}`);
    await expect(page.getByRole('button', { name: 'Abrir áreas' })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir áreas' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Abrir áreas' })).toBeFocused();
  }
  await page.getByRole('button', { name: 'Abrir áreas' }).click();
  await page.getByRole('navigation', { name: 'Áreas principales' }).getByRole('link', { name: 'Trabajo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trabajo', exact: true })).toBeVisible();
  await page.goto('/gym/#/home');
  await page.getByRole('link', { name: 'Personal OS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('la portada muestra estados vacíos y poblados en escritorio y móvil, ambos temas', async ({ page }) => {
  const state = await dashboardFixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Lo próximo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tus áreas', exact: true })).toBeVisible();

  const scheduled = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date('2026-11-17T15:00:00Z'));

  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /^Tema / }).click();
      state.data.recent = [];
      state.data.current = [];
      state.data.upcoming = [];
      state.data.snapshots = [];
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
      await expect(page.getByText('Sin próximos compromisos registrados', { exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/dashboard-empty-${width}-${theme}.png`, fullPage: true });

      await expect(page.getByRole('heading', { name: 'En marcha', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Actividad reciente', exact: true })).toHaveCount(0);

      state.data.recent.push({ id: 'recent-test', title: 'Cierre semanal de prueba', kind: 'note', status: 'completed', created_at: '2026-11-15T12:00:00Z' });
      state.data.current.push({ id: 'current-test', title: 'Proyecto personal de prueba', kind: 'task', status: 'active' });
      state.data.upcoming.push({ id: 'upcoming-test', title: 'Revisar agenda de prueba', kind: 'event', status: 'active', due_at: '2026-11-17T15:00:00Z' });
      state.data.snapshots.push(
        { area: 'health', source: 'gym', observed_at: '2026-11-16T12:00:00Z', received_at: '2026-11-16T12:00:00Z', payload: { summary: 'Entrenamiento de prueba', metrics: [], items: [], references: [], telemetry: [] } },
        { area: 'work', source: 'calendar', observed_at: '2026-11-16T12:00:00Z', received_at: '2026-11-16T12:00:00Z', payload: { summary: 'Reunión de prueba', metrics: [], items: [], references: [], telemetry: [] } },
      );
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { name: 'En marcha', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Actividad reciente', exact: true })).toBeVisible();
      await expect(page.getByText('Proyecto personal de prueba')).toBeVisible();
      await expect(page.getByText('Cierre semanal de prueba')).toBeVisible();
      await expect(page.getByText('Revisar agenda de prueba')).toBeVisible();
      await expect(page.getByText(scheduled)).toBeVisible();
      await expect(page.getByText('Entrenamiento de prueba')).toBeVisible();
      await expect(page.getByText('Reunión de prueba')).toBeVisible();
      for (const [, label] of lifeAreas) await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Abrir Google Calendar', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Abrir gimnasio', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/dashboard-populated-${width}-${theme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Abrir áreas', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Áreas de mi vida' })).toBeVisible();
      await page.screenshot({ path: `test-results/dashboard-drawer-${width}-${theme}.png`, fullPage: true });
      await page.keyboard.press('Escape');
    }
  }
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('patrimonio sin comparación, telemetría antigua y error conservan datos honestos', async ({ page }) => {
  const state = await dashboardFixture(page);
  state.data.finance.networth.push({ currency: 'CLP', assets_minor: 200000, liabilities_minor: 50000, networth_minor: 150000, as_of: '2026-11-16T12:00:00Z', change_percent: null, comparison_at: null });
  state.data.snapshots.push({ area: 'system', source: 'homelab', observed_at: '2026-01-01T00:00:00Z', received_at: '2026-01-01T00:00:00Z', payload: { summary: 'Resumen de prueba conservado', metrics: [], items: [], references: [{ source: 'Fuente de prueba', url: 'javascript:alert(1)' }], telemetry: [{ entity_id: 'hp', kind: 'device', label: 'HP de prueba', status: 'online', observed_at: '2026-01-01T00:00:00Z', metrics: {} }] } });
  await page.goto('/areas/work/finance');
  await expect(page.getByText('Sin comparación disponible', { exact: true })).toBeVisible();
  await expect(page.getByText('$150.000', { exact: true })).toBeVisible();
  await page.goto('/areas/system/overview');
  await expect(page.getByText('Sin señal reciente', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fuente de prueba' })).toHaveCount(0);
  state.fail = true;
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo actualizar');
  await expect(page.getByText('Resumen de prueba conservado', { exact: true })).toBeVisible();
  state.fail = false;
  await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('el próximo entrenamiento aparece aunque todavía no haya sesiones registradas', async ({ page }) => {
  const state = await dashboardFixture(page);
  state.data.gym.next_training = { title: 'Torso', date: '2026-11-17' };
  await page.goto('/areas/health/upcoming');
  await expect(page.getByText('Próximo entrenamiento: Torso · 2026-11-17')).toBeVisible();
  state.data.gym.next_training = { title: 'Piernas', due_at: '2026-11-18T15:00:00Z' };
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  const scheduled = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date('2026-11-18T15:00:00Z'));
  await expect(page.getByText(`Próximo entrenamiento: Piernas · ${scheduled}`)).toBeVisible();
  expect(state.errors).toEqual([]);
});
