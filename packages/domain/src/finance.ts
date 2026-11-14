export const minorUnitDigits = { CLP: 0, USD: 2, EUR: 2, GBP: 2, JPY: 0, BRL: 2 } as const;
export type Currency = keyof typeof minorUnitDigits;

/** Parse decimal input without floating-point rounding. CLP/JPY use grouped integers;
 * USD/GBP use en-US notation; EUR/BRL use decimal comma. Specify locale to override. */
export function parseMoney(input: string, currency: string = 'CLP', locale?: 'es-CL' | 'en-US'): number {
  if (!(currency in minorUnitDigits)) throw new RangeError(`Unsupported currency: ${currency}`);
  const digits = minorUnitDigits[currency as Currency];
  const convention = locale ?? (['USD', 'GBP'].includes(currency) ? 'en-US' : 'es-CL');
  const decimal = convention === 'en-US' ? '.' : ',';
  const thousands = convention === 'en-US' ? ',' : '.';
  let text = input.trim().replace(/\u2212/g, '-').replace(/\u00a0/g, ' ');
  text = text.replace(/^(?:CLP|USD|EUR|GBP|JPY|BRL)\s*/i, '').replace(/^[$€£¥R]\s*/, '').trim();
  if (!text) throw new Error('Amount is required');
  let sign = 1n;
  if (text.startsWith('-')) { sign = -1n; text = text.slice(1); }
  if (!text || /[^\d.,]/.test(text)) throw new Error('Invalid amount');
  const parts = text.split(decimal);
  if (parts.length > 2) throw new Error('Invalid decimal separators');
  const whole = parts[0]!;
  const fractional = parts[1];
  if (whole.includes(thousands)) {
    const groups = whole.split(thousands);
    if (!/^\d{1,3}$/.test(groups[0]!) || groups.slice(1).some((group) => !/^\d{3}$/.test(group))) {
      throw new Error('Invalid thousands grouping');
    }
  } else if (!/^\d+$/.test(whole)) throw new Error('Invalid whole amount');
  if (fractional !== undefined && (!/^\d+$/.test(fractional) || fractional.length > digits)) {
    throw new Error(`Amount supports ${digits} decimal places`);
  }
  const wholeDigits = whole.split(thousands).join('');
  const amount = sign * (BigInt(wholeDigits) * (10n ** BigInt(digits)) + BigInt((fractional ?? '').padEnd(digits, '0') || '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Amount is too large');
  return Number(amount);
}

export interface FinancialTransaction {
  id: string;
  amountMinor: number;
  currency: string;
  direction: 'expense' | 'income' | 'refund' | 'transfer';
  status: 'draft' | 'confirmed' | 'void';
  category?: string;
  evidenceId?: string;
}

export function summarizeFinance(transactions: readonly FinancialTransaction[], currency: string = 'CLP') {
  let incomeMinor = 0; let expenseMinor = 0; let refundMinor = 0; let draftCount = 0;
  const byCategory: Record<string, number> = {};
  for (const tx of transactions) {
    if (!Number.isSafeInteger(tx.amountMinor) || tx.amountMinor < 0) throw new Error('Transactions require non-negative integer minor units');
    if (tx.currency !== currency || tx.status === 'void') continue;
    if (tx.status === 'draft') { draftCount++; continue; }
    if (tx.direction === 'income') incomeMinor += tx.amountMinor;
    if (tx.direction === 'expense' || tx.direction === 'refund') {
      const signed = tx.direction === 'expense' ? tx.amountMinor : -tx.amountMinor;
      if (tx.direction === 'expense') expenseMinor += tx.amountMinor;
      else refundMinor += tx.amountMinor;
      const category = tx.category || 'uncategorized';
      byCategory[category] = (byCategory[category] ?? 0) + signed;
    }
  }
  const netExpenseMinor = expenseMinor - refundMinor;
  const netMinor = incomeMinor - netExpenseMinor;
  if ([incomeMinor, expenseMinor, refundMinor, netMinor].some((n) => !Number.isSafeInteger(n))) throw new RangeError('Totals exceed safe integer range');
  return { currency, incomeMinor, expenseMinor, refundMinor, netExpenseMinor, netMinor, draftCount, byCategory };
}

export interface EvidenceIdentity { id: string; ownerId: string; source: string; externalId?: string | null; sha256?: string | null }
export interface EvidenceMatch { evidenceId: string; matchedId: string | null; reason: 'external_id' | 'sha256' | null }

/** Exact matching only. Equal date, amount, or merchant is deliberately insufficient. */
export function reconcileEvidence(evidence: readonly EvidenceIdentity[], candidates: readonly EvidenceIdentity[]): EvidenceMatch[] {
  return evidence.map((item) => {
    const possible = candidates.filter((candidate) => candidate.ownerId === item.ownerId && candidate.id !== item.id);
    const external = item.externalId && possible.find((candidate) => candidate.source === item.source && candidate.externalId === item.externalId);
    if (external) return { evidenceId: item.id, matchedId: external.id, reason: 'external_id' };
    const hash = item.sha256?.toLowerCase();
    const identical = hash && /^[a-f0-9]{64}$/.test(hash) && possible.find((candidate) => candidate.sha256?.toLowerCase() === hash);
    return { evidenceId: item.id, matchedId: identical ? identical.id : null, reason: identical ? 'sha256' : null };
  });
}
