import { describe, expect, it } from 'vitest';
import { parseDashboardDelivery, telemetryFresh } from '../src/dashboard.js';

const delivery = { version: 1, id: '1ca98b07-4de8-45fd-b952-365f42fd3278', area: 'work', source: 'test.finance', observed_at: '2026-11-16T12:00:00Z', summary: 'Resumen de prueba' };

describe('dashboard boundary', () => {
  it('accepts sourced summaries and rejects unsafe links, unknown fields and invalid valuations', () => {
    expect(parseDashboardDelivery(delivery)).toMatchObject({ metrics: [], items: [], references: [] });
    expect(() => parseDashboardDelivery({ ...delivery, token: 'never accepted' })).toThrow();
    for (const url of ['javascript:alert(1)', 'https://user:secret@example.org', 'file:///etc/passwd']) {
      expect(() => parseDashboardDelivery({ ...delivery, references: [{ source: 'test', url }] })).toThrow();
    }
    const valuations = [{ account_ref: 'savings', name: 'Cuenta de prueba', kind: 'asset', currency: 'CLP', amount_minor: 100, valued_at: delivery.observed_at, source_ref: 'statement:1' }];
    expect(parseDashboardDelivery({ ...delivery, valuations }).valuations).toHaveLength(1);
    expect(() => parseDashboardDelivery({ ...delivery, area: 'health', valuations })).toThrow();
    expect(() => parseDashboardDelivery({ ...delivery, valuations: [{ ...valuations[0], amount_minor: 0.5 }] })).toThrow();
  });

  it('bounds payload size and distinguishes a fresh observation from a stale or future one', () => {
    expect(() => parseDashboardDelivery({ ...delivery, summary: 'x'.repeat(270000) })).toThrow('dashboard_delivery_too_large');
    const now = Date.parse(delivery.observed_at);
    expect(telemetryFresh(delivery.observed_at, now + 89999)).toBe(true);
    expect(telemetryFresh(delivery.observed_at, now + 90001)).toBe(false);
    expect(telemetryFresh('not-a-date', now)).toBe(false);
    expect(telemetryFresh(delivery.observed_at, now - 31000)).toBe(false);
  });
});
