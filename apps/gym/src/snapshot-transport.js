/**
 * openGym's logical API stays unchanged. Only large state transfers use staging.
 * Every wire request stays below Vercel's payload limit; incomplete uploads do not
 * change the current state. The server commits with baseRev + baseWid atomically.
 */
export const SNAPSHOT_CHUNK_BYTES = 256 * 1024
export const INLINE_STATE_BYTES = 1024 * 1024
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000))
  }
  return btoa(binary)
}

export function base64ToBytes(text) {
  if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('Invalid snapshot chunk encoding')
  }
  const binary = atob(text)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export async function sha256(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('Secure snapshot verification requires HTTPS')
  const hash = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

function jsonResponse(body, status = 200, headers) {
  const next = new Headers(headers)
  next.delete('content-length')
  next.delete('content-encoding')
  next.set('content-type', 'application/json')
  next.set('cache-control', 'private, no-store')
  return new Response(JSON.stringify(body), { status, headers: next })
}

function manifestValid(snapshot) {
  return snapshot && typeof snapshot.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(snapshot.id)
    && Number.isInteger(snapshot.parts) && snapshot.parts > 0 && snapshot.parts <= Math.ceil(MAX_SNAPSHOT_BYTES / SNAPSHOT_CHUNK_BYTES)
    && Number.isInteger(snapshot.bytes) && snapshot.bytes > 0 && snapshot.bytes <= MAX_SNAPSHOT_BYTES
    && snapshot.chunkBytes === SNAPSHOT_CHUNK_BYTES
    && snapshot.parts === Math.ceil(snapshot.bytes / snapshot.chunkBytes)
    && typeof snapshot.sha256 === 'string' && /^[0-9a-f]{64}$/.test(snapshot.sha256)
}

export function createGymFetch({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getAccessToken = async () => null,
  origin = typeof location === 'undefined' ? 'https://personal-ai-os.invalid' : location.origin,
  apiBase = '/gym/api',
  cryptoImpl = globalThis.crypto,
} = {}) {
  const base = apiBase.replace(/\/$/, '')

  function apiUrl(input) {
    const target = new URL(input, origin)
    if (target.origin !== origin || !(target.pathname === base || target.pathname.startsWith(base + '/'))) {
      throw new Error('Refusing to send the shared session outside the gym API')
    }
    return target
  }

  async function send(url, init = {}) {
    const target = apiUrl(url)
    const token = await getAccessToken()
    const headers = new Headers(init.headers)
    if (token) headers.set('authorization', 'Bearer ' + token)
    else headers.delete('authorization')
    return fetchImpl(target.pathname + target.search, {
      ...init, headers, credentials: 'same-origin', cache: 'no-store',
    })
  }

  async function hydrate(response, signal) {
    let body
    try { body = await response.clone().json() } catch { return response }
    if (!body?.snapshot) return response
    if (!manifestValid(body.snapshot)) return jsonResponse({ error: 'Invalid gym snapshot manifest' }, 502)
    const snapshot = body.snapshot
    const bytes = new Uint8Array(snapshot.bytes)
    let offset = 0
    for (let index = 0; index < snapshot.parts; index++) {
      const part = await send(`${base}/snapshots/${encodeURIComponent(snapshot.id)}/chunks/${index}`, { signal })
      if (!part.ok) return part
      let chunk
      try {
        const data = await part.json()
        if (data.index !== index) throw new Error('Unexpected snapshot chunk index')
        chunk = base64ToBytes(data.data)
        const wanted = Math.min(snapshot.chunkBytes, snapshot.bytes - offset)
        if (chunk.length !== wanted) throw new Error('Unexpected snapshot chunk length')
        bytes.set(chunk, offset)
      } catch {
        return jsonResponse({ error: 'Invalid gym snapshot chunk' }, 502)
      }
      offset += chunk.length
    }
    if (await sha256(bytes, cryptoImpl) !== snapshot.sha256) {
      return jsonResponse({ error: 'Gym snapshot integrity verification failed' }, 502)
    }
    let state
    try {
      state = JSON.parse(decoder.decode(bytes))
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid state')
    } catch {
      return jsonResponse({ error: 'Invalid gym snapshot state' }, 502)
    }
    const { snapshot: ignored, ...metadata } = body
    return jsonResponse({ ...metadata, state }, response.status, response.headers)
  }

  return async function gymFetch(input, init = {}) {
    const url = apiUrl(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.pathname === `${base}/data` && method === 'PUT' && typeof init.body === 'string') {
      const payload = JSON.parse(init.body)
      const bytes = encoder.encode(JSON.stringify(payload.state))
      if (bytes.length > MAX_SNAPSHOT_BYTES) {
        return jsonResponse({ error: 'El perfil supera 8 MiB. Exporta una copia antes de continuar.' }, 413)
      }
      if (bytes.length > INLINE_STATE_BYTES) {
        const parts = Math.ceil(bytes.length / SNAPSHOT_CHUNK_BYTES)
        const begin = await send(`${base}/snapshots`, {
          method: 'POST', signal: init.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseRev: payload.baseRev ?? null, baseWid: payload.baseWid ?? null,
            stamped: payload.stamped === true, parts, bytes: bytes.length,
            sha256: await sha256(bytes, cryptoImpl),
          }),
        })
        if (!begin.ok) return hydrate(begin, init.signal)
        const { uploadId } = await begin.json()
        if (typeof uploadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(uploadId)) {
          return jsonResponse({ error: 'Invalid gym snapshot upload identifier' }, 502)
        }
        for (let index = 0; index < parts; index++) {
          const chunk = bytes.subarray(index * SNAPSHOT_CHUNK_BYTES, (index + 1) * SNAPSHOT_CHUNK_BYTES)
          const saved = await send(`${base}/snapshots/${encodeURIComponent(uploadId)}/chunks/${index}`, {
            method: 'PUT', signal: init.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: bytesToBase64(chunk) }),
          })
          if (!saved.ok) return hydrate(saved, init.signal)
        }
        const committed = await send(`${base}/snapshots/${encodeURIComponent(uploadId)}/commit`, {
          method: 'POST', signal: init.signal,
          headers: { 'content-type': 'application/json' }, body: '{}',
        })
        return hydrate(committed, init.signal)
      }
    }
    return hydrate(await send(input, init), init.signal)
  }
}
