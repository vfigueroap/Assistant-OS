import { describe, expect, it } from 'vitest';
import { canonicalActionHash, evaluateAction, parseMoney, planWeek, reconcileEvidence, summarizeFinance, validateApproval, parseJobResult } from '../src/index.js';

describe('integer money', () => {
  it('parses Chilean pesos and decimal currencies exactly', () => {
    expect(parseMoney('$12.500')).toBe(12500);
    expect(parseMoney('0.29', 'USD')).toBe(29);
    expect(parseMoney('1.234,50', 'EUR')).toBe(123450);
    expect(parseMoney('-10')).toBe(-10);
    expect(parseMoney('R$ 1,25', 'BRL')).toBe(125);
  });
  it('rejects fractions of pesos, malformed groups, unsafe totals, and ambiguous notation', () => {
    for (const input of ['1,50', '12.34', '1e3', 'NaN', '9007199254740992']) expect(() => parseMoney(input)).toThrow();
    expect(() => parseMoney('1.234', 'USD')).toThrow();
  });
  it('keeps drafts and transfers out of financial progress', () => {
    const base = { currency: 'CLP', status: 'confirmed' as const };
    const summary = summarizeFinance([{ ...base, id: '1', amountMinor: 10000, direction: 'income' }, { ...base, id: '2', amountMinor: 3000, direction: 'expense' }, { ...base, id: '3', amountMinor: 500, direction: 'refund' }, { ...base, id: '4', amountMinor: 9000, direction: 'transfer' }, { ...base, id: '5', amountMinor: 999, direction: 'expense', status: 'draft' }]);
    expect(summary.netMinor).toBe(7500); expect(summary.draftCount).toBe(1);
  });
  it('sums categories without inherited object properties', () => {
    const base = { currency: 'CLP', status: 'confirmed' as const, direction: 'expense' as const };
    const summary = summarizeFinance(['__proto__', 'constructor', 'toString'].map((category, i) => ({ ...base, id: String(i), amountMinor: 100, category })));
    expect(Object.values(summary.byCategory)).toEqual([100, 100, 100]);
  });
  it('matches evidence only by exact owner-scoped identity', () => {
    const hash = 'a'.repeat(64);
    const result = reconcileEvidence([{ id: 'new', ownerId: 'a', source: 'gmail', externalId: 'mail-1', sha256: hash }], [{ id: 'foreign', ownerId: 'b', source: 'gmail', externalId: 'mail-1', sha256: hash }, { id: 'same', ownerId: 'a', source: 'telegram', sha256: hash }]);
    expect(result[0]).toEqual({ evidenceId: 'new', matchedId: 'same', reason: 'sha256' });
  });
});

describe('action authorization', () => {
  const policy = { autonomyLevel: 3 as const, paused: false, allowedTools: ['calendar.create'], allowExternalModels: false, remainingBudgetUsd: 1 };
  const action = { tool: 'calendar.create', payload: { title: 'Study' }, risk: 'low' as const, reversible: true, externalImpact: true };
  it('requires exact approval for external effects and rejects pause, forbidden tools and costs', () => {
    expect(evaluateAction(action, policy).requiresApproval).toBe(true);
    expect(evaluateAction(action, { ...policy, paused: true }).allowed).toBe(false);
    expect(evaluateAction({ ...action, estimatedCostUsd: 2 }, policy).allowed).toBe(false);
    expect(evaluateAction({ ...action, destructiveOriginal: true }, policy).allowed).toBe(false);
    expect(evaluateAction({ ...action, tool: 'shell' }, policy).allowed).toBe(false);
  });
  it('hashes stable JSON and invalidates changed or expired approvals', async () => {
    expect(await canonicalActionHash({ a: 1, b: 2 })).toBe(await canonicalActionHash({ b: 2, a: 1 }));
    const approval = { status: 'approved', payloadHash: await canonicalActionHash(action), expiresAt: '2030-01-01T00:00:00Z' };
    expect(await validateApproval(action, approval)).toBe(true);
    expect(await validateApproval({ ...action, payload: { title: 'Changed' } }, approval)).toBe(false);
    expect(await validateApproval(action, { ...approval, expiresAt: '2000-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('capacity planning', () => {
  it('keeps a window available when an earlier task cannot meet its deadline', () => {
    const result = planWeek({ availability: [{ startAt: '2026-11-16T10:00:00Z', endAt: '2026-11-16T12:00:00Z' }], tasks: [{ id: 'late', title: 'Late', durationMinutes: 30, priority: 2, dueAt: '2026-11-16T10:05:00Z' }, { id: 'next', title: 'Next', durationMinutes: 30, priority: 1 }] });
    expect(result.blocks.map(block => block.sourceId)).toEqual(['next']);
    expect(result.unscheduled.map(task => task.taskId)).toEqual(['late']);
  });
  it('uses later days in a continuous window after the daily limit is reached', () => {
    const result = planWeek({ availability: [{ startAt: '2026-11-16T23:00:00Z', endAt: '2026-11-17T02:00:00Z' }], preferences: { dailyWorkMinutes: 30, bufferMinutes: 0 }, tasks: [{ id: 'a', title: 'A', durationMinutes: 60, priority: 1 }] });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]?.startAt).toBe('2026-11-17T00:00:00.000Z');
    expect(result.unscheduled).toEqual([]);
  });
  it('preserves availability and reports overload instead of filling rest', () => {
    const result = planWeek({ availability: [{ startAt: '2026-11-16T13:00:00Z', endAt: '2026-11-16T15:00:00Z' }], tasks: [{ id: 'a', title: 'Math', durationMinutes: 90, priority: 2, kind: 'study' }, { id: 'b', title: 'Startup', durationMinutes: 90, priority: 1 }] });
    expect(result.blocks[0]?.sourceId).toBe('a');
    expect(result.blocks.every((b) => Date.parse(b.endAt) <= Date.parse('2026-11-16T15:00:00Z'))).toBe(true);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
  it('rejects overlapping availability and cannot schedule after a deadline', () => {
    expect(() => planWeek({ availability: [{ startAt: '2026-01-01T10:00Z', endAt: '2026-01-01T12:00Z' }, { startAt: '2026-01-01T11:00Z', endAt: '2026-01-01T13:00Z' }], tasks: [] })).toThrow();
    const result = planWeek({ availability: [{ startAt: '2026-01-01T10:00Z', endAt: '2026-01-01T12:00Z' }], tasks: [{ id: 'a', title: 'x', priority: 1, durationMinutes: 120, dueAt: '2026-01-01T11:00Z' }] });
    expect(result.unscheduled[0]?.remainingMinutes).toBe(60);
  });
  it('validates worker-produced planner blocks', () => {
    expect(() => parseJobResult('planner.week', { summary: 'x', blocks: [{ title: 'x', kind: 'study', start_at: '2026-01-01T12:00:00Z', end_at: '2026-01-01T11:00:00Z' }] })).toThrow();
  });
});
