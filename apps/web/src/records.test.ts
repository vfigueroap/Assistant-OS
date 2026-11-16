import { describe, expect, it } from 'vitest';
import { putLocalRecord, readLocalRecords, safeReturnTo, storageKey, writeLocalRecords } from './records.js';

describe('registros locales', () => {
  it('conserva registros y rechaza datos dañados sin sobrescribirlos', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readLocalRecords(storage)).toEqual([]);
    const record = { id: crypto.randomUUID(), kind: 'note' as const, title: 'Apunte', status: 'active', due_at: null, data: { text: 'Conservar' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    writeLocalRecords(storage, [record]);
    expect(readLocalRecords(storage)).toEqual([record]);
    const second = { ...record, id: crypto.randomUUID(), title: 'Otra pestaña' };
    putLocalRecord(storage, second, null);
    expect(putLocalRecord(storage, { ...record, title: 'Actualizado', updated_at: '2026-11-15T00:00:00.000Z' }, record.updated_at)).toHaveLength(2);
    expect(() => putLocalRecord(storage, record, record.updated_at)).toThrow('otra pestaña');
    expect(readLocalRecords(storage).find(item => item.id === record.id)?.title).toBe('Actualizado');
    values.set(storageKey, '{incorrecto');
    expect(() => readLocalRecords(storage)).toThrow();
    expect(values.get(storageKey)).toBe('{incorrecto');
  });

  it('solo permite volver a destinos del portal', () => {
    expect(safeReturnTo('/gym/')).toBe('/gym/');
    for (const value of ['https://example.org', '//example.org', '/\\example.org', 'javascript:alert(1)', 'http://[']) expect(safeReturnTo(value)).toBe('/');
  });
});
