import { test, expect, type Page } from '@playwright/test';

async function local(page: Page) {
  await page.route('**/api/config', route => route.fulfill({ json: { configured: false, supabaseUrl: '', supabasePublishableKey: '' } }));
  await page.goto('/');
  await expect(page.getByText('Todavía no tienes registros.', { exact: false })).toBeVisible();
}

test('crear, editar, completar, archivar, restaurar, filtrar y exportar persisten al recargar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await local(page);
  await page.getByLabel('Título', { exact: true }).fill('Preparar la semana');
  await page.getByLabel('Fecha y hora').fill('2026-11-16T09:30');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparar la semana' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Preparar la semana', exact: true }).click();
  await expect(page.getByLabel('Título', { exact: true })).toBeFocused();
  await page.getByLabel('Título', { exact: true }).fill('Preparar el lunes');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('button', { name: 'Completar Preparar el lunes', exact: true }).click();
  await expect(page.getByText('Tarea · Completado')).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir Preparar el lunes', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Preparar el lunes', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar edición' }).click();
  await page.getByRole('button', { name: 'Archivar Preparar el lunes', exact: true }).click();
  await page.reload();
  await page.getByText('Archivados', { exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar Preparar el lunes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparar el lunes' })).toBeVisible();
  await page.getByLabel('Mostrar').selectOption('note');
  await expect(page.getByText('No hay registros de este tipo.')).toBeVisible();
  await page.getByLabel('Mostrar').selectOption('all');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar copia' }).click();
  expect((await download).suggestedFilename()).toMatch(/^personal-os-.*\.json$/);
  await page.getByRole('link', { name: 'Conexión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Guardado en este equipo' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a mis registros' }).click();
  await expect(page.getByRole('heading', { name: 'Preparar el lunes' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('datos dañados y almacenamiento lleno no destruyen el contenido ni bloquean corregir un título', async ({ page }) => {
  await local(page);
  await page.getByLabel('Título', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Escribe un título');
  await page.getByLabel('Título', { exact: true }).fill('Nota conservada');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nota conservada' })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('assistant-os-records-v1', '{dañado'));
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('No reemplazar');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('assistant-os-records-v1'))).toBe('{dañado');
  await page.evaluate(() => localStorage.removeItem('assistant-os-records-v1'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Guardar registro', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) { if (key === 'assistant-os-records-v1') throw new DOMException('sin espacio', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.getByLabel('Título', { exact: true }).fill('Texto que conservar');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No hay espacio');
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Texto que conservar');
  expect(await page.evaluate(() => localStorage.getItem('assistant-os-records-v1'))).toBeNull();
});

test('dos pestañas conservan nuevas entradas y detectan una edición obsoleta', async ({ page, context }) => {
  await local(page);
  const second = await context.newPage();
  await second.route('**/api/config', route => route.fulfill({ json: { configured: false, supabaseUrl: '', supabasePublishableKey: '' } }));
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Guardar registro', exact: true })).toBeEnabled();
  await page.getByLabel('Título', { exact: true }).fill('Primero');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Primero' })).toBeVisible();
  await second.getByRole('button', { name: 'Editar Primero', exact: true }).click();
  await page.getByRole('button', { name: 'Completar Primero', exact: true }).click();
  await expect(second.getByText('Tarea · Completado')).toBeVisible();
  await second.getByLabel('Título', { exact: true }).fill('Edición obsoleta');
  await second.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(second.getByRole('alert')).toContainText('otra pestaña');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('assistant-os-records-v1')!)[0].status)).toBe('completed');
});

test('carga y error de conexión tienen respuesta visible', async ({ page }) => {
  await page.route('**/api/config', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ status: 503, json: { error: 'sin conexión' } }); });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Abriendo');
  await expect(page.getByRole('alert')).toContainText('No se pudo comprobar la conexión');
  await page.unroute('**/api/config');
  await page.route('**/api/config', route => route.fulfill({ json: { configured: false, supabaseUrl: '', supabasePublishableKey: '' } }));
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(page.getByText('Modo local.', { exact: false })).toBeVisible();
});

test('móvil, tableta y escritorio conservan controles visibles en ambos temas', async ({ page }) => {
  await local(page);
  await page.getByLabel('Título', { exact: true }).fill('Un título muy largo '.repeat(30));
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (let theme = 0; theme < 2; theme++) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const contrasts = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const luminance = (color: string) => {
          let hex = color.trim().slice(1);
          if (hex.length === 3) hex = [...hex].map(character => character + character).join('');
          const components = color.trim().startsWith('#') ? hex.match(/../g)!.map(value => parseInt(value, 16)) : color.match(/\d+/g)!.slice(0, 3).map(Number);
          const linear = components.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
          return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
        };
        const ratio = (a: string, b: string) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
        return ['--ink', '--muted', '--accent', '--error'].flatMap(name => [style.backgroundColor, style.getPropertyValue('--paper')].map(background => ratio(style.getPropertyValue(name), background)));
      });
      expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
      const targets = await page.locator('button:visible, nav a').evaluateAll(elements => elements.map(element => ({ label: element.textContent, height: element.getBoundingClientRect().height })));
      expect(targets.filter(target => target.height < 44)).toEqual([]);
      await page.getByRole('button', { name: /^Tema / }).click();
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: 'test-results/personal-os-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await page.screenshot({ path: 'test-results/personal-os-mobile-dark.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/personal-os-desktop.png', fullPage: true });
});

test('el formulario se puede usar con teclado y el foco es visible', async ({ page }) => {
  await local(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ir al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('Título', { exact: true }).focus();
  expect(await page.getByLabel('Título', { exact: true }).evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.type('Desde el teclado');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Desde el teclado' })).toBeVisible();
});
