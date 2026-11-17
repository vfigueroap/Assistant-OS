import { effectiveRoutineIds } from '../../vendor/opengym/frontend/src/lib/history.js';

export function gymDashboardPlan(state: Record<string, unknown>, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const source = {
    ...state,
    routines: Array.isArray(state.routines) ? state.routines : [],
    workouts: Array.isArray(state.workouts) ? state.workouts : [],
    week: state.week && typeof state.week === 'object' ? state.week : {},
    dayPlan: state.dayPlan && typeof state.dayPlan === 'object' ? state.dayPlan : {},
  };
  const days: Array<{ date: string; title: string; routine_ids: string[] }> = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const iso = date.toISOString().slice(0, 10);
    const ids = effectiveRoutineIds(source, iso, today);
    const routines = source.routines.filter((routine: any) => ids.includes(routine?.id) && Array.isArray(routine.ex) && routine.ex.length);
    if (routines.length) days.push({ date: iso, title: routines.map((routine: any) => String(routine.name || 'Rutina')).join(' + ').slice(0, 1000), routine_ids: routines.map((routine: any) => String(routine.id)).slice(0, 20) });
  }
  return { projected_for: today, days };
}
