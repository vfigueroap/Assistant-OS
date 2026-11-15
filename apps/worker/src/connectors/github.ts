import { jsonRequest, ProviderError } from '../http.js';
import { secret } from '../config.js';

export async function syncProjects(repositories: string[], signal?: AbortSignal) {
  const allowed = (process.env.GITHUB_ALLOWED_REPOSITORIES ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!repositories.length || repositories.some(r => !allowed.includes(r) || !/^[\w.-]+\/[\w.-]+$/.test(r))) throw new ProviderError('github_repository_not_allowlisted', false);
  const token = await secret('GITHUB_TOKEN');
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const projects = [];
  for (const repository of repositories) {
    const issues = await jsonRequest<Array<{ number: number; title: string; html_url: string; state: string; pull_request?: unknown }>>(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100`, { headers, signal });
    projects.push({ repository, title: repository, summary: `${issues.filter(i => !i.pull_request).length} issues abiertos en la primera página.`, data: { issues: issues.filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title, url: i.html_url, state: i.state })), truncated: issues.length === 100 } });
  }
  return { projects };
}
