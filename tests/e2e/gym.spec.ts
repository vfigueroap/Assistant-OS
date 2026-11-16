import { test, expect } from '@playwright/test';

test('el gimnasio compilado abre y conserva la navegación con el portal sin cuenta configurada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/config', route => route.fulfill({ json: { configured: false, supabaseUrl: '', supabasePublishableKey: '' } }));
  await page.goto('/gym/');
  const login = page.getByRole('link', { name: 'Entrar desde el portal', exact: true });
  await expect(login).toBeVisible();
  await expect(page.getByRole('link', { name: 'Código fuente AGPL' })).toHaveAttribute('href', /^https:\/\//);
  await page.getByRole('link', { name: 'Volver al portal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lo que quieres hacer y recordar' })).toBeVisible();
  await page.getByRole('link', { name: 'Gimnasio', exact: true }).click();
  await login.click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fgym%2F/);
  await expect(page.getByRole('heading', { name: 'Guardado en este equipo' })).toBeVisible();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/gym/');
    await expect(login).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/personal-os-gym.png', fullPage: true });
  expect(errors).toEqual([]);
});
