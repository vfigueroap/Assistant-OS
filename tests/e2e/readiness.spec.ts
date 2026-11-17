import { expect, test } from '@playwright/test';

test('puedes seguir usando los registros locales cuando la cuenta está configurada', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true, supabaseUrl: 'https://supabase.example.org', supabasePublishableKey: 'sb_publishable_readiness_fixture' } }));
  await page.goto('/login');
  await page.getByRole('link', { name: 'Usar registros de este navegador', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Anotar algo', exact: true })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Mi nota local');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await page.getByRole('link', { name: 'Conexión', exact: true }).click();
  await expect(page.getByText('Estás usando los registros de este navegador.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a mis registros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mi nota local', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Conexión', exact: true }).click();
  await page.getByRole('link', { name: 'Entrar a mi cuenta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar a tu espacio', exact: true })).toBeVisible();
});

test('el servidor entrega solo configuración pública y protege el gimnasio sin sesión', async ({ request }) => {
  const response = await request.get('/api/config');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const config = await response.json();
  expect(Object.keys(config).sort()).toEqual(['configured', 'supabasePublishableKey', 'supabaseUrl']);
  expect(typeof config.configured).toBe('boolean');
  if (config.configured) {
    const url = new URL(config.supabaseUrl);
    expect(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))).toBe(true);
    expect(url.username === '' && url.password === '').toBe(true);
    const key = String(config.supabasePublishableKey);
    const publicKey = key.startsWith('sb_publishable_') || (!key.startsWith('sb_secret_') && JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role === 'anon');
    expect(publicKey).toBe(true);
  } else {
    expect(config.supabaseUrl === '' && config.supabasePublishableKey === '').toBe(true);
  }
  const gym = await request.get('/gym/api/me');
  expect(gym.status()).toBe(config.configured ? 401 : 503);
});

test('portal y gimnasio conectados permiten llegar al acceso sin credenciales ni llamadas externas', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  const blocked: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    if (url.pathname === '/api/config') return route.fulfill({ json: { configured: true, supabaseUrl: 'https://supabase.example.org', supabasePublishableKey: 'sb_publishable_readiness_fixture' } });
    return route.continue();
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Entrar a tu espacio', exact: true })).toBeVisible();
  await expect(page.getByLabel('Correo', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Abrir áreas', exact: true }).click();
  await page.getByRole('link', { name: 'Salud', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fareas%2Fhealth%2Foverview$/);
  await expect(page.getByRole('heading', { name: 'Entrar a tu espacio', exact: true })).toBeVisible();
  await page.goto('/gym/');
  await expect(page.getByRole('heading', { name: 'Accede al gimnasio', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Entrar desde el portal', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fgym%2F$/);
  await expect(page.getByRole('heading', { name: 'Entrar a tu espacio', exact: true })).toBeVisible();
  await expect(page.getByLabel('Correo', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});
