#!/usr/bin/env node
import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const upstream = path.join(root, 'vendor/opengym')
const frontend = path.join(upstream, 'frontend')
const output = path.join(root, 'dist/gym')
const pinned = '5f5832db56080837b58342ff50f78631dcc63e07'

async function exists(file) { try { await access(file); return true } catch { return false } }
async function run(command, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
  })
}

if (!await exists(path.join(upstream, 'NOTICE.md'))) throw new Error('Missing pinned vendor/opengym source snapshot')
const pkg = JSON.parse(await readFile(path.join(frontend, 'package.json'), 'utf8'))
if (pkg.version !== '1.4.4') throw new Error('Unexpected openGym version; review and update the integration before upgrading')
const vite = path.join(frontend, 'node_modules/vite/bin/vite.js')
if (!await exists(vite)) {
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], frontend)
}
await mkdir(output, { recursive: true })
await run(process.execPath, [vite, 'build', '--outDir', output, '--emptyOutDir'], frontend, {
  ...process.env,
  APP_BUILD: `assistant-os.${pinned.slice(0, 8)}`,
  VITE_DEMO: '0',
  VITE_MOBILE: '0',
  VITE_GYM_SOURCE_URL: process.env.VITE_GYM_SOURCE_URL || `https://github.com/vfigueroap/Assistant-OS/tree/${process.env.VERCEL_GIT_COMMIT_SHA || 'main'}`,
  VITE_IMG_BASE: '/gym/exercise-media/still/',
  VITE_GIF_BASE: '/gym/exercise-media/clip/',
})
await run(process.execPath, [path.join(upstream, 'scripts/catalogue/stage-media.mjs'), output], upstream)
await cp(path.join(upstream, 'LICENSE'), path.join(output, 'LICENSE'))
await cp(path.join(upstream, 'NOTICE.md'), path.join(output, 'NOTICE.md'))
await writeFile(path.join(output, 'upstream.json'), JSON.stringify({ name: 'openGym', version: '1.4.4', commit: pinned, adapted: true }) + '\n')
console.log('openGym: original training UI, licensed media and cloud adapter built at dist/gym/')
