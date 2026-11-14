import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createGymFetch, bytesToBase64, base64ToBytes, sha256, SNAPSHOT_CHUNK_BYTES } from '../../apps/gym/src/snapshot-transport.js'

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

async function snapshot(state, id = 'snapshot_1') {
  const bytes = new TextEncoder().encode(JSON.stringify(state))
  return {
    bytes,
    manifest: { id, parts: Math.ceil(bytes.length / SNAPSHOT_CHUNK_BYTES), bytes: bytes.length, sha256: await sha256(bytes, webcrypto), chunkBytes: SNAPSHOT_CHUNK_BYTES },
  }
}

test('shared session reaches only the same-origin gym API', async () => {
  const calls = []
  const request = createGymFetch({ getAccessToken: async () => 'owner-token', fetchImpl: async (url, init) => { calls.push({ url, init }); return json({ user: { id: 'owner' } }) } })
  await request('/gym/api/me')
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer owner-token')
  assert.equal(calls[0].init.cache, 'no-store')
  await assert.rejects(request('https://attacker.invalid/gym/api/me'), /outside the gym API/)
  assert.equal(calls.length, 1)
})

test('state larger than 4.5 MB is staged in 256 KiB chunks and committed with CAS', async () => {
  const state = { workouts: [], routines: [], notes: 'á'.repeat(2_400_000) }
  const chunks = []
  let metadata
  let committed = false
  const calls = []
  const request = createGymFetch({ cryptoImpl: webcrypto, getAccessToken: async () => 'owner-token', fetchImpl: async (url, init) => {
    calls.push({ url, size: typeof init.body === 'string' ? new TextEncoder().encode(init.body).length : 0 })
    assert.equal(init.headers.get('authorization'), 'Bearer owner-token')
    if (url === '/gym/api/snapshots') { metadata = JSON.parse(init.body); return json({ uploadId: 'upload_1' }) }
    const part = /\/chunks\/(\d+)$/.exec(url)
    if (part) { chunks[Number(part[1])] = base64ToBytes(JSON.parse(init.body).data); return json({ ok: true }) }
    if (url.endsWith('/commit')) { committed = true; return json({ ok: true, rev: 8, wid: 'new_write' }) }
    throw new Error(url)
  } })
  const response = await request('/gym/api/data', { method: 'PUT', body: JSON.stringify({ state, baseRev: 7, baseWid: 'prior_write', stamped: true }) })
  assert.equal(response.status, 200)
  assert.equal(committed, true)
  assert.equal(metadata.baseRev, 7)
  assert.equal(metadata.baseWid, 'prior_write')
  assert.equal(metadata.stamped, true)
  assert.ok(metadata.bytes > 4_500_000)
  assert.ok(chunks.every(chunk => chunk.length <= SNAPSHOT_CHUNK_BYTES))
  assert.ok(calls.every(call => call.size < 400_000))
  const rebuilt = new Uint8Array(metadata.bytes)
  let offset = 0
  for (const chunk of chunks) { rebuilt.set(chunk, offset); offset += chunk.length }
  assert.equal(await sha256(rebuilt, webcrypto), metadata.sha256)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(rebuilt)), state)
})

test('a failed intermediate chunk never commits the partial state', async () => {
  const calls = []
  const request = createGymFetch({ cryptoImpl: webcrypto, fetchImpl: async (url) => {
    calls.push(url)
    if (url === '/gym/api/snapshots') return json({ uploadId: 'upload_partial' })
    return json({ error: 'network interrupted' }, 503)
  } })
  const response = await request('/gym/api/data', { method: 'PUT', body: JSON.stringify({ state: { note: 'a'.repeat(1_100_000) }, baseRev: 1 }) })
  assert.equal(response.status, 503)
  assert.ok(!calls.some(url => url.endsWith('/commit')))
})

test('a large 409 response is hydrated before the existing merge logic sees it', async () => {
  const state = { workouts: [{ id: 'phone-workout' }], note: 'x'.repeat(1_200_000) }
  const data = await snapshot(state)
  const request = createGymFetch({ cryptoImpl: webcrypto, fetchImpl: async url => {
    const part = /\/chunks\/(\d+)$/.exec(url)
    if (part) {
      const index = Number(part[1])
      return json({ index, data: bytesToBase64(data.bytes.subarray(index * SNAPSHOT_CHUNK_BYTES, (index + 1) * SNAPSHOT_CHUNK_BYTES)) })
    }
    return json({ error: 'conflict', rev: 9, wid: 'phone_write', snapshot: data.manifest }, 409)
  } })
  const response = await request('/gym/api/data', { method: 'PUT', body: JSON.stringify({ state: { workouts: [] }, baseRev: 8 }) })
  assert.equal(response.status, 409)
  const result = await response.json()
  assert.deepEqual(result.state, state)
  assert.equal(result.rev, 9)
  assert.equal(result.snapshot, undefined)
})

test('tampering is refused before a snapshot can replace local data', async () => {
  const data = await snapshot({ workouts: [], note: 'original' })
  const request = createGymFetch({ cryptoImpl: webcrypto, fetchImpl: async url => {
    if (url.includes('/chunks/')) return json({ index: 0, data: bytesToBase64(new Uint8Array(data.bytes.length).fill(32)) })
    return json({ rev: 1, snapshot: data.manifest })
  } })
  const response = await request('/gym/api/data')
  assert.equal(response.status, 502)
  assert.match((await response.json()).error, /integrity/)
})
