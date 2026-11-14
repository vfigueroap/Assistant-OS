import { createClient } from '@supabase/supabase-js'

let client
let pendingClient

/** The default Supabase storage key is shared with the portal on this origin. */
export async function gymSessionClient() {
  if (client) return client
  if (pendingClient) return pendingClient
  pendingClient = (async () => {
    let url = import.meta.env.VITE_SUPABASE_URL
    let key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) {
      const response = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error('No se pudo cargar la configuración del portal')
      const config = await response.json()
      url = config.supabaseUrl
      key = config.supabasePublishableKey
    }
    if (!url || !key) return null
    if (String(key).startsWith('sb_secret_')) throw new Error('Una clave secreta no puede usarse en el navegador')
    client = createClient(url, key, {
      auth: { storageKey: 'assistant-os-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
    return client
  })()
  try { return await pendingClient } finally { pendingClient = null }
}

export async function gymAccessToken() {
  const supabase = await gymSessionClient()
  if (!supabase) return null
  // Refresh is handled by Supabase. The API verifies the token and owner on every call;
  // a local session alone is never an authorization decision.
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.access_token || null
}

export function portalLoginUrl() {
  return '/login?returnTo=' + encodeURIComponent('/gym/')
}

export async function signOutSharedSession() {
  const supabase = await gymSessionClient()
  if (supabase) {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }
  window.location.assign(portalLoginUrl())
}
