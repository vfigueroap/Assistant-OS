import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { mergeStates, stampChange } from '../../vendor/opengym/frontend/src/lib/sync-merge.js'

const base = () => ({ unit: 'kg', lang: 'es', _ts: 100, workouts: [], routines: [{ id: 'routine', name: 'Fuerza', ex: [] }], bodyweight: [], customEx: [], favEx: [], exWeights: {}, week: { 1: ['routine'] } })

test('offline phone results survive a concurrent planner change and remain unique', () => {
  const old = base()
  const phone = structuredClone(old)
  phone.workouts.push({ id: 'phone_1', d: '2026-11-14', start: 1, entries: [] })
  stampChange(old, phone, 200)
  const planner = structuredClone(old)
  planner.routines[0].name = 'Fuerza adaptada'
  planner.week = { 2: ['routine'] }
  stampChange(old, planner, 300)
  const merged = mergeStates(phone, planner)
  assert.deepEqual(merged.workouts.map(workout => workout.id), ['phone_1'])
  assert.equal(merged.routines[0].name, 'Fuerza adaptada')
  assert.deepEqual(merged.week, { 2: ['routine'] })
  assert.equal(mergeStates(merged, phone).workouts.length, 1)
})

test('gym service worker activation keeps portal caches and bypasses auth/data', async () => {
  const source = await readFile(new URL('../../vendor/opengym/frontend/public/sw.js', import.meta.url), 'utf8')
  const listeners = new Map()
  const deleted = []
  const cache = { match: async () => new Response('shell'), keys: async () => [], put: async () => {}, delete: async () => true }
  const context = {
    self: { addEventListener: (event, fn) => listeners.set(event, fn), clients: { claim: async () => {} }, registration: { scope: 'https://portal.invalid/gym/' } },
    caches: { keys: async () => ['assistant-os-shell-v1', 'portal-notes', 'opengym-rt-old', 'opengym-rt-__BUILD__', 'opengym-media-v1', 'opengym-device'], open: async () => cache, delete: async name => { deleted.push(name); return true } },
    location: new URL('https://portal.invalid/gym/sw.js'), URL, Response, Request, Headers, Uint8Array, Map, Set, console,
  }
  vm.runInNewContext(source, context)
  let activation
  listeners.get('activate')({ waitUntil: promise => { activation = promise } })
  await activation
  assert.deepEqual(deleted, ['opengym-rt-old'])
  for (const pathname of ['/api/config', '/gym/api/me', '/gym/api/data', '/gym/api/snapshots/x/chunks/0']) {
    let cached = false
    listeners.get('fetch')({ request: new Request('https://portal.invalid' + pathname), respondWith: () => { cached = true } })
    assert.equal(cached, false, pathname)
  }
})
