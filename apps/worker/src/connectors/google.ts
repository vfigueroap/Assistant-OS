import { secret } from '../config.js';
import { jsonRequest, ProviderError } from '../http.js';

export class GoogleToken {
  private cached?: { value: string; expires: number };
  constructor(private readonly purpose: 'GMAIL' | 'CALENDAR') {}
  async get(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expires) return this.cached.value;
    const refresh = await secret(`GOOGLE_${this.purpose}_REFRESH_TOKEN`);
    const clientId = process.env.GOOGLE_CLIENT_ID; const clientSecret = await secret('GOOGLE_CLIENT_SECRET');
    if (!refresh || !clientId || !clientSecret) throw new ProviderError('google_oauth_not_configured', false);
    const result = await jsonRequest<{ access_token: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
    });
    this.cached = { value: result.access_token, expires: Date.now() + Math.max(0, result.expires_in - 60) * 1000 };
    return this.cached.value;
  }
}
