export interface TimeWindow { startAt: string; endAt: string }
export interface PlannerTask { id: string; title: string; durationMinutes: number; priority: number; dueAt?: string; kind?: 'study' | 'training' | 'work' | 'rest' }
export interface PlanBlock extends TimeWindow { sourceId: string; title: string; kind: 'study' | 'training' | 'work' | 'rest' }
export interface PlanInput {
  availability: readonly TimeWindow[];
  tasks: readonly PlannerTask[];
  preferences?: { bufferMinutes?: number; maxBlockMinutes?: number; dailyWorkMinutes?: number };
}
export interface PlanResult { blocks: PlanBlock[]; unscheduled: { taskId: string; remainingMinutes: number; reason: string }[]; warnings: string[] }

/** Deterministic finite-capacity planner. Availability already excludes fixed commitments and sleep. */
export function planWeek(input: PlanInput): PlanResult {
  const buffer = input.preferences?.bufferMinutes ?? 10;
  const maxBlock = input.preferences?.maxBlockMinutes ?? 90;
  const dailyMax = input.preferences?.dailyWorkMinutes ?? 360;
  if (!Number.isInteger(buffer) || buffer < 0 || !Number.isInteger(maxBlock) || maxBlock < 15 || !Number.isInteger(dailyMax) || dailyMax < 15) throw new Error('Invalid planner preferences');
  const windows = input.availability.map((w) => ({ start: Date.parse(w.startAt), end: Date.parse(w.endAt) })).sort((a, b) => a.start - b.start);
  windows.forEach((w, i) => {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start) throw new Error('Invalid availability window');
    if (i && w.start < windows[i - 1]!.end) throw new Error('Availability windows overlap');
  });
  const tasks = [...input.tasks];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error('Duplicate task id');
    seen.add(task.id);
    if (!Number.isInteger(task.durationMinutes) || task.durationMinutes < 1 || !Number.isFinite(task.priority)) throw new Error('Invalid task estimate');
    if (task.dueAt && !Number.isFinite(Date.parse(task.dueAt))) throw new Error('Invalid task deadline');
  }
  tasks.sort((a, b) => b.priority - a.priority || (Date.parse(a.dueAt ?? '') || Infinity) - (Date.parse(b.dueAt ?? '') || Infinity) || a.id.localeCompare(b.id));
  const blocks: PlanBlock[] = []; const unscheduled: PlanResult['unscheduled'] = []; const warnings: string[] = [];
  const workByDay = new Map<string, number>();
  for (const task of tasks) {
    let remaining = task.durationMinutes;
    const deadline = task.dueAt ? Date.parse(task.dueAt) : Infinity;
    for (const window of windows) {
      while (remaining > 0 && window.start < Math.min(window.end, deadline)) {
        const day = new Date(window.start).toISOString().slice(0, 10);
        const midnight = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
        const capacity = Math.floor((Math.min(window.end, deadline, midnight) - window.start) / 60_000);
        const dailyLeft = dailyMax - (workByDay.get(day) ?? 0);
        const amount = Math.min(remaining, capacity, maxBlock, dailyLeft);
        if (amount < Math.min(15, remaining)) { window.start = Math.min(window.end, midnight); break; }
        const end = window.start + amount * 60_000;
        blocks.push({ sourceId: task.id, title: task.title, kind: task.kind ?? 'work', startAt: new Date(window.start).toISOString(), endAt: new Date(end).toISOString() });
        workByDay.set(day, (workByDay.get(day) ?? 0) + amount);
        remaining -= amount;
        window.start = end + buffer * 60_000;
      }
      if (!remaining) break;
    }
    if (remaining) unscheduled.push({ taskId: task.id, remainingMinutes: remaining, reason: 'Insufficient availability before the deadline; commitments and rest were preserved' });
  }
  if (unscheduled.length) warnings.push('The requested workload exceeds available capacity. No fixed commitments or rest windows were moved.');
  return { blocks: blocks.sort((a, b) => a.startAt.localeCompare(b.startAt)), unscheduled, warnings };
}
