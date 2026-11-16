import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { StateStore } from '../../apps/worker/src/state.js';
import { BudgetLedger } from '../../apps/worker/src/llm.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

it('keeps model reservations when reported cost is invalid and enforces the budget', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'personal-os-budget-')); directories.push(directory);
  const ledger = new BudgetLedger(new StateStore(directory), 1);
  const month = await ledger.reserve('request', 0.75);
  for (const invalid of [-1, NaN, Infinity]) await expect(ledger.settle(month, 'request', invalid)).rejects.toThrow('invalid_model_cost');
  await expect(ledger.reserve('over-budget', 0.3)).rejects.toThrow('monthly_model_budget_exhausted');
  await ledger.settle(month, 'request', 0.5);
  await expect(ledger.reserve('within-budget', 0.5)).resolves.toBe(month);
});

it('releases the state lock after an operation fails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'personal-os-state-')); directories.push(directory);
  const store = new StateStore(directory);
  await expect(store.exclusive('test', async () => { throw new Error('interrupted'); })).rejects.toThrow('interrupted');
  await expect(store.exclusive('test', async () => { await store.write('state', { saved: true }); return store.read('state', {}); })).resolves.toEqual({ saved: true });
});
