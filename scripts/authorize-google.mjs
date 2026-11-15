#!/usr/bin/env node
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, chmod } from 'node:fs/promises'

const purpose = process.argv[2]
if (!['gmail', 'calendar'].includes(purpose)) {
  console.error('Uso: node scripts/authorize-google.mjs gmail|calendar')
  process.exit(2)
}
try { process.loadEnvFile('.env.hp') } catch { console.error('Primero crea .env.hp a partir de .env.hp.example'); process.exit(2) }
const clientId = process.env.GOOGLE_CLIENT_ID
const clientSecret = process.env.GOOGLE_CLIENT_SECRET
if (!clientId || !clientSecret) { console.error('Completa GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.hp'); process.exit(2) }
const port = 8765
const redirectUri = `http://127.0.0.1:${port}/callback`
const verifier = randomBytes(64).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
const state = randomBytes(24).toString('base64url')
const scopes = purpose === 'gmail'
  ? ['https://www.googleapis.com/auth/gmail.readonly']
  : ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.app.created']
const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' })) auth.searchParams.set(key, value)

let finish
const done = new Promise((resolve, reject) => { finish = { resolve, reject } })
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', redirectUri)
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state || url.searchParams.has('error')) throw new Error('Autorización no válida o rechazada')
    const code = url.searchParams.get('code')
    if (!code) throw new Error('Google no entregó un código')
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code_verifier: verifier, grant_type: 'authorization_code' }) })
    const token = await tokenResponse.json()
    if (!tokenResponse.ok || typeof token.refresh_token !== 'string') throw new Error('Google no entregó refresh token; revisa scopes, tipo Desktop y modo OAuth')
    const key = purpose === 'gmail' ? 'GOOGLE_GMAIL_REFRESH_TOKEN' : 'GOOGLE_CALENDAR_REFRESH_TOKEN'
    const contents = await readFile('.env.hp', 'utf8')
    const escaped = String(token.refresh_token).replace(/[\r\n]/g, '')
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    const updated = pattern.test(contents) ? contents.replace(pattern, `${key}=${escaped}`) : `${contents.trimEnd()}\n${key}=${escaped}\n`
    await writeFile('.env.hp', updated, { mode: 0o600 })
    await chmod('.env.hp', 0o600)
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Autorización guardada en el HP. Ya puedes cerrar esta pestaña.')
    finish.resolve()
  } catch (error) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('No se completó la autorización. Revisa la terminal del HP.')
    finish.reject(error)
  } finally { server.close() }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Abre esta dirección en un navegador de confianza:\n${auth.toString()}`)
  console.log(`Si entras por SSH desde otro equipo, crea antes un túnel: ssh -L ${port}:127.0.0.1:${port} usuario@HP`)
})
const timeout = setTimeout(() => { server.close(); finish.reject(new Error('Tiempo de autorización agotado')) }, 5 * 60 * 1000)
try { await done; console.log('Autorización almacenada sin mostrar el token.') }
catch (error) { console.error(String(error)); process.exitCode = 1 }
finally { clearTimeout(timeout) }
