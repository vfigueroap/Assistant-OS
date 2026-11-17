import { z } from 'zod';

export const areaIds = ['work', 'health', 'spirituality', 'romantic', 'family-friends', 'five-buckets', 'system', 'business', 'education'] as const;
export type AreaId = typeof areaIds[number];
export const bucketIds = ['knowledge', 'skill', 'resources', 'network', 'reputation'] as const;
const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const safeUrl = z.url().refine(value => {
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
}, 'Only HTTP(S) references without credentials are allowed');

export const dashboardDeliverySchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  area: z.enum(areaIds),
  source: text(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  observed_at: instant,
  summary: z.string().max(20000),
  metrics: z.array(z.object({ key: text(100), label: text(200), value: z.union([z.number().finite(), z.string().max(1000)]), unit: text(50).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict()).max(30).default([]),
  items: z.array(z.object({
    id: text(200), title: text(1000),
    kind: z.enum(['activity', 'current', 'next', 'reflection', 'opportunity', 'contact', 'learning', 'skill', 'resource', 'reputation', 'plan']),
    status: text(100).optional(), due_at: instant.optional(), bucket: z.enum(bucketIds).optional(), source_ref: text(500).optional(),
  }).strict()).max(200).default([]),
  references: z.array(z.object({ source: text(100), external_id: text(1000).optional(), url: safeUrl.optional(), local_ref: text(500).optional() }).strict()).max(100).default([]),
  valuations: z.array(z.object({
    account_ref: text(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/), name: text(200), kind: z.enum(['asset', 'liability']),
    currency: z.string().regex(/^[A-Z]{3}$/), amount_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    valued_at: instant, source_ref: text(500),
  }).strict()).max(100).optional(),
  telemetry: z.array(z.object({
    entity_id: text(200), kind: z.enum(['agent', 'device', 'service', 'connector']), label: text(200),
    status: z.enum(['online', 'idle', 'busy', 'error', 'limited', 'offline', 'unconfigured']), observed_at: instant,
    metrics: z.record(z.string().max(100), z.union([z.number().finite(), z.string().max(1000), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 30).default({}),
  }).strict()).max(100).optional(),
}).strict().refine(value => !value.valuations?.length || value.area === 'work', 'Financial valuations belong to work');

export type DashboardDelivery = z.infer<typeof dashboardDeliverySchema>;
export const maxDashboardBytes = 256 * 1024;
export function parseDashboardDelivery(value: unknown): DashboardDelivery {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxDashboardBytes) throw new Error('dashboard_delivery_too_large');
  return dashboardDeliverySchema.parse(value);
}

export function telemetryFresh(observedAt: string, now = Date.now()): boolean {
  const observed = Date.parse(observedAt);
  return Number.isFinite(observed) && observed <= now + 30000 && now - observed <= 90000;
}
