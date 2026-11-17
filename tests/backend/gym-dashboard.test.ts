import { expect, it } from 'vitest';
import { gymDashboardPlan } from '../../apps/api/gym-dashboard.js';

it('projects the upstream multi-routine schedule with date overrides in Santiago time', () => {
  const routines = [{ id: 'a', name: 'Rutina A', ex: [{ id: 'squat' }] }, { id: 'b', name: 'Rutina B', ex: [{ id: 'row' }] }];
  const state = { routines, workouts: [], week: { 1: ['a', 'b'], 2: ['a'] }, dayPlan: { '2026-11-17': 'rest' } };
  const plan = gymDashboardPlan(state, new Date('2026-11-16T01:00:00Z'));
  expect(plan.projected_for).toBe('2026-11-15');
  expect(plan.days).toEqual([{ date: '2026-11-16', title: 'Rutina A + Rutina B', routine_ids: ['a', 'b'] }]);
  expect(gymDashboardPlan({}, new Date('2026-11-16T12:00:00Z')).days).toEqual([]);
});
