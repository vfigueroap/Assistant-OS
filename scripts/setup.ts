import { access, copyFile } from 'node:fs/promises';

try { await access('.env.local'); console.log('Local configuration already exists.'); }
catch { await copyFile('.env.example', '.env.local'); console.log('Created .env.local from the example. Set only the public Supabase URL and publishable key for local development.'); }
console.log('Read README.md before creating the owner and worker identities. Keep passwords and OAuth tokens out of Git.');
