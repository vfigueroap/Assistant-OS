export interface ActionInput {
  tool: string;
  payload: unknown;
  risk: 'low' | 'medium' | 'high';
  reversible: boolean;
  externalImpact: boolean;
  sendsSensitiveData?: boolean;
  destructiveOriginal?: boolean;
  estimatedCostUsd?: number;
}
export interface ActionPolicy {
  autonomyLevel: 0 | 1 | 2 | 3 | 4;
  paused: boolean;
  allowedTools: readonly string[];
  allowExternalModels: boolean;
  remainingBudgetUsd: number;
  approvedPayloadHash?: string;
}
export type ActionDecision = { allowed: boolean; requiresApproval: boolean; reason: string };

export function evaluateAction(action: ActionInput, policy: ActionPolicy): ActionDecision {
  const deny = (reason: string): ActionDecision => ({ allowed: false, requiresApproval: false, reason });
  if (policy.paused) return deny('Execution is paused');
  if (action.destructiveOriginal) return deny('Original files, photos and contacts cannot be deleted automatically');
  if (!policy.allowedTools.includes(action.tool)) return deny('Tool is not authorized');
  if (!Number.isFinite(policy.remainingBudgetUsd) || policy.remainingBudgetUsd < 0) return deny('Invalid cost budget');
  const cost = action.estimatedCostUsd ?? 0;
  if (!Number.isFinite(cost) || cost < 0 || cost > policy.remainingBudgetUsd) return deny('Cost budget exceeded');
  if (action.sendsSensitiveData && !policy.allowExternalModels) return deny('Sending sensitive data is not authorized');
  if (policy.autonomyLevel < 2) return deny('This autonomy level permits observation and recommendations only');
  const approval = policy.autonomyLevel === 2 || action.risk !== 'low' || !action.reversible || action.externalImpact;
  return { allowed: true, requiresApproval: approval, reason: approval ? 'A current approval for the exact payload is required' : 'Pre-authorized low-risk action' };
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers cannot be hashed');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) throw new Error('Action payload must contain plain JSON values');
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  throw new Error('Action payload must contain plain JSON values');
}

export async function canonicalActionHash(input: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export async function validateApproval(action: unknown, approval: { payloadHash: string; expiresAt: string; status: string }, now: Date = new Date()): Promise<boolean> {
  if (approval.status !== 'approved' || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now.getTime()) return false;
  return approval.payloadHash === await canonicalActionHash(action);
}
