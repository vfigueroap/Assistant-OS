import { z } from 'zod';

export const kinds = {
  task: 'Tarea', note: 'Nota', project: 'Proyecto', goal: 'Objetivo', event: 'Evento',
  course: 'Curso', topic: 'Tema', assessment: 'Evaluación', study_session: 'Sesión de estudio',
  training_plan: 'Plan de entrenamiento', health_metric: 'Registro de salud', contact: 'Contacto', decision: 'Decisión',
} as const;

export const recordSchema = z.object({
  id: z.uuid(), owner_id: z.uuid().optional(), kind: z.enum(Object.keys(kinds) as [keyof typeof kinds, ...(keyof typeof kinds)[]]),
  title: z.string().trim().min(1).max(1000), status: z.string().min(1), due_at: z.iso.datetime({ offset: true }).nullable(),
  data: z.record(z.string(), z.unknown()).default({}), created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }), deleted_at: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type PersonalRecord = z.infer<typeof recordSchema>;
export const storageKey = 'assistant-os-records-v1';

export function readLocalRecords(storage: Pick<Storage, 'getItem'>): PersonalRecord[] {
  const value = storage.getItem(storageKey);
  return value === null ? [] : z.array(recordSchema).parse(JSON.parse(value));
}

export function writeLocalRecords(storage: Pick<Storage, 'setItem'>, records: PersonalRecord[]) {
  storage.setItem(storageKey, JSON.stringify(z.array(recordSchema).parse(records)));
}

export function putLocalRecord(storage: Pick<Storage, 'getItem' | 'setItem'>, record: PersonalRecord, expectedUpdatedAt: string | null): PersonalRecord[] {
  const latest = readLocalRecords(storage);
  const current = latest.find(item => item.id === record.id);
  if ((current?.updated_at ?? null) !== expectedUpdatedAt) throw new Error('Este registro cambió en otra pestaña. Vuelve a cargarlo antes de editar.');
  const next = current ? latest.map(item => item.id === record.id ? record : item) : [record, ...latest];
  writeLocalRecords(storage, next);
  return next;
}

export function safeReturnTo(value: string | null): string {
  if (!value) return '/';
  try {
    const url = new URL(value, 'https://personal.invalid');
    return url.origin === 'https://personal.invalid' ? url.pathname + url.search + url.hash : '/';
  } catch { return '/'; }
}
