export class ProviderError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly status?: number) { super(code); }
}
/** Never include provider URLs, tokens, response bodies, or document contents in errors. */
export async function jsonRequest<T>(url: string | URL, options: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal, redirect: 'error' });
    if (!response.ok) throw new ProviderError(`provider_http_${response.status}`, response.status === 429 || response.status >= 500, response.status);
    return await response.json() as T;
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('provider_network_error', true); }
  finally { clearTimeout(timer); }
}
export async function boundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new ProviderError('download_failed', response.status >= 500);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new ProviderError('file_too_large', false);
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > maxBytes) throw new ProviderError('file_too_large', false); parts.push(next.value); }
  } finally { await reader.cancel(); }
  const output = new Uint8Array(total); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output;
}
