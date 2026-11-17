import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { kinds, putLocalRecord, readLocalRecords, recordSchema, safeReturnTo, storageKey, type PersonalRecord } from './records.js';
import { PersonalNavigation } from './navigation.js';

type Connection = { mode: 'local' } | { mode: 'cloud'; client: SupabaseClient; session: Session | null };
const columns = 'id,owner_id,kind,title,status,due_at,data,created_at,updated_at,deleted_at';
const pageSize = 100;
const localOnly = new URLSearchParams(location.search).get('local') === '1';
const homeUrl = localOnly ? '/?local=1' : '/records';
const settingsUrl = localOnly ? '/settings?local=1' : '/settings';

function App() {
  const [connection, setConnection] = useState<Connection>();
  const [error, setError] = useState('');
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [kind, setKind] = useState(new URLSearchParams(location.search).get('kind') ?? 'all');
  const [editing, setEditing] = useState<PersonalRecord | null>(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('assistant-os-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
    catch { return 'light'; }
  });
  const titleInput = useRef<HTMLInputElement>(null);
  const loadVersion = useRef(0);
  const signingIn = useRef(false);
  const settings = location.pathname === '/settings' || location.pathname === '/login';

  useEffect(() => { if (editing) titleInput.current?.focus(); }, [editing]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('assistant-os-theme', theme); } catch { /* La elección sigue vigente durante esta sesión. */ }
  }, [theme]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    async function connect() {
      try {
        if (localOnly) { setConnection({ mode: 'local' }); return; }
        let url = import.meta.env.VITE_SUPABASE_URL;
        let key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) {
          const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('No se pudo comprobar la conexión. Inicia también la API local y vuelve a cargar.');
          const config = await response.json();
          url = config.supabaseUrl;
          key = config.supabasePublishableKey;
        }
        if (!url && !key) {
          if (active) setConnection({ mode: 'local' });
          return;
        }
        if (!url || !key || key.startsWith('sb_secret_')) throw new Error('La configuración pública de conexión no es válida.');
        const parsedUrl = new URL(url);
        if (parsedUrl.username || parsedUrl.password || (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname)))) throw new Error('La conexión requiere HTTPS y una dirección sin credenciales.');
        if (key.includes('.')) {
          const payload = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
          if (payload.role !== 'anon') throw new Error('El navegador solo admite una clave pública.');
        }
        const { createClient } = await import('@supabase/supabase-js');
        const client = createClient(url, key, { auth: { storageKey: 'assistant-os-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw new Error('No se pudo recuperar la sesión.');
        let authVersion = 0;
        async function activate(session: Session | null) {
          const version = ++authVersion;
          if (session) {
            const owner = await client.rpc('is_workspace_owner');
            if (!active || version !== authVersion) return;
            if (owner.error) throw new Error('No se pudo comprobar el acceso a tu cuenta.');
            if (owner.data !== true) {
              await client.auth.signOut();
              if (active) setError('Esta cuenta no es la propietaria del espacio.');
              session = null;
            }
          }
          if (active && version === authVersion) { setRecords([]); setConnection({ mode: 'cloud', client, session }); }
        }
        await activate(data.session);
        const { data: listener } = client.auth.onAuthStateChange((event, session) => {
          if (!active || event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && signingIn.current)) return;
          setRecords([]);
          // Auth callbacks run under a lock; verify ownership after that callback returns.
          setTimeout(() => { void activate(session).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo comprobar tu cuenta.'); }); }, 0);
        });
        unsubscribe = () => { listener.subscription.unsubscribe(); client.auth.stopAutoRefresh(); };
        if (!active) unsubscribe();
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir el espacio personal.'); setLoading(false); }
      }
    }
    void connect();
    return () => { active = false; unsubscribe?.(); };
  }, []);

  async function load(append = false, clearError = true) {
    if (!connection) return;
    const version = ++loadVersion.current;
    setLoading(true);
    if (clearError) setError('');
    try {
      if (connection.mode === 'local') { setRecords(readLocalRecords(localStorage)); setMore(false); }
      else if (connection.session) {
        const offset = append ? records.length : 0;
        const { data, error: queryError } = await connection.client.from('records').select(columns).order('created_at', { ascending: false }).order('id').range(offset, offset + pageSize - 1);
        if (queryError) throw new Error('No se pudieron cargar los registros. Comprueba la conexión y los permisos de tu cuenta.');
        if (version !== loadVersion.current) return;
        const parsed = (data ?? []).map(value => recordSchema.parse(value));
        setRecords(previous => append ? [...previous, ...parsed] : parsed); setMore(parsed.length === pageSize);
      }
    } catch (cause) { if (version === loadVersion.current) setError(connection.mode === 'local' ? 'No se pudieron leer los registros de este navegador. El contenido guardado no se modificó.' : cause instanceof Error ? cause.message : 'No se pudieron leer los registros.'); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }

  useEffect(() => {
    void load(false, false);
    function refresh(event: StorageEvent) { if (connection?.mode === 'local' && event.key === storageKey) void load(false, false); }
    window.addEventListener('storage', refresh);
    return () => { loadVersion.current++; window.removeEventListener('storage', refresh); };
  }, [connection]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || busy || loading) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (!String(values.get('title') ?? '').trim()) { setError('Escribe un título antes de guardar.'); return; }
    setBusy(true); setError('');
    try {
      const now = new Date().toISOString();
      const due = String(values.get('due') ?? '');
      const record = recordSchema.parse({ ...editing, id: editing?.id ?? crypto.randomUUID(), kind: values.get('kind'), title: values.get('title'), due_at: due ? new Date(due).toISOString() : null, status: editing?.status ?? 'active', data: editing?.data ?? {}, created_at: editing?.created_at ?? now, updated_at: now });
      let saved = record;
      if (connection.mode === 'cloud') {
        if (!connection.session) throw new Error('Inicia sesión antes de guardar.');
        const payload = { title: record.title, kind: record.kind, due_at: record.due_at };
        const query = editing ? connection.client.from('records').update(payload).eq('id', record.id).eq('updated_at', editing.updated_at) : connection.client.from('records').insert({ ...payload, owner_id: connection.session.user.id });
        const result = await query.select(columns).single();
        if (result.error) throw new Error('No se pudo guardar. Tu texto sigue en el formulario.');
        saved = recordSchema.parse(result.data);
      }
      const next = connection.mode === 'local'
        ? await navigator.locks.request(storageKey, () => putLocalRecord(localStorage, saved, editing?.updated_at ?? null))
        : editing ? records.map(item => item.id === saved.id ? saved : item) : [saved, ...records];
      setRecords(next); setEditing(null); form.reset(); titleInput.current?.focus();
    } catch (cause) { setError(cause instanceof Error && cause.name === 'QuotaExceededError' ? 'No hay espacio en este navegador. Tu texto sigue en el formulario.' : cause instanceof Error && !['ZodError', 'SyntaxError'].includes(cause.name) ? cause.message : 'No se pudo guardar el registro. Comprueba el título, la fecha y el almacenamiento.'); }
    finally { setBusy(false); }
  }

  async function change(record: PersonalRecord, patch: Partial<Pick<PersonalRecord, 'status' | 'deleted_at'>>) {
    if (!connection || busy) return;
    setBusy(true); setError('');
    try {
      let updated = { ...record, ...patch, updated_at: new Date().toISOString() };
      if (connection.mode === 'cloud') {
        const result = await connection.client.from('records').update(patch).eq('id', record.id).eq('updated_at', record.updated_at).select(columns).single();
        if (result.error) throw new Error('No se pudo actualizar. El registro se conserva.');
        updated = recordSchema.parse(result.data);
      }
      const next = connection.mode === 'local'
        ? await navigator.locks.request(storageKey, () => putLocalRecord(localStorage, updated, record.updated_at))
        : records.map(item => item.id === record.id ? updated : item);
      setRecords(next);
      if (editing?.id === record.id) setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el registro.'); }
    finally { setBusy(false); }
  }

  function exportRecords() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `personal-os-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (connection?.mode !== 'cloud') return;
    const values = new FormData(event.currentTarget); setBusy(true); setError('');
    signingIn.current = true;
    try {
      const result = await connection.client.auth.signInWithPassword({ email: String(values.get('email')), password: String(values.get('password')) });
      if (result.error) throw new Error('No se pudo iniciar sesión. Revisa tus datos y la conexión.');
      const owner = await connection.client.rpc('is_workspace_owner');
      if (owner.error || owner.data !== true) { await connection.client.auth.signOut(); throw new Error('Esta cuenta no es la propietaria del espacio.'); }
      location.assign(safeReturnTo(new URLSearchParams(location.search).get('returnTo')));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.'); }
    finally { signingIn.current = false; setBusy(false); }
  }

  const signedIn = connection?.mode === 'cloud' && connection.session;
  const canUseRecords = connection?.mode === 'local' || signedIn;
  const visible = records.filter(record => !record.deleted_at && (kind === 'all' || record.kind === kind));

  return <>
    <PersonalNavigation theme={theme} onThemeChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}/>
    <main id="main">
      <div className="intro"><p className="date">{new Intl.DateTimeFormat('es-CL', { dateStyle: 'full' }).format(new Date())}</p><h1>{settings ? 'Tu conexión' : 'Lo que quieres hacer y recordar'}</h1><p>{connection?.mode === 'local' ? 'Modo local. Tus registros se guardan solo en este navegador; exporta una copia para conservarlos.' : signedIn ? 'Tu espacio personal conectado.' : 'Tareas, notas y fechas en un solo lugar.'}</p></div>
      {error && <div className="error" role="alert"><p>{error}</p><button type="button" onClick={() => connection ? void load() : location.reload()} disabled={loading}>Volver a intentar</button></div>}
      {!connection && !error && <p role="status">Abriendo tu espacio…</p>}
      {settings && connection?.mode === 'local' && <section className="connection"><h2>Guardado en este equipo</h2><p>{localOnly ? 'Estás usando los registros de este navegador.' : 'No hay una cuenta configurada. Puedes usar tus registros sin iniciar sesión.'} El gimnasio y las automatizaciones requieren la conexión a tu espacio privado.</p><p>Los registros locales y los de la cuenta se conservan por separado.</p><a href={homeUrl}>Volver a mis registros</a>{localOnly && <p><a href="/login">Entrar a mi cuenta</a></p>}</section>}
      {connection?.mode === 'cloud' && !signedIn && <section className="connection"><h2>Entrar a tu espacio</h2><form onSubmit={signIn}><label htmlFor="email">Correo</label><input id="email" name="email" type="email" autoComplete="username" required/><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" required/><button className="primary" disabled={busy} type="submit">{busy ? 'Entrando…' : 'Iniciar sesión'}</button></form><p><a href="/?local=1">Usar registros de este navegador</a></p></section>}
      {settings && signedIn && <section className="connection"><h2>Sesión iniciada</h2><p>{signedIn.user.email}</p><p>Los registros se guardan en tu cuenta. El gimnasio comparte esta sesión.</p><button type="button" disabled={busy} onClick={async () => { if (connection?.mode !== 'cloud') return; setBusy(true); const result = await connection.client.auth.signOut(); if (result.error) setError('No se pudo cerrar la sesión. Inténtalo de nuevo.'); setBusy(false); }}>Cerrar sesión</button></section>}
      {!settings && canUseRecords && <div className="workspace">
        <section className="editor"><h2>{editing ? 'Editar registro' : 'Anotar algo'}</h2><form key={editing?.id ?? 'new'} onSubmit={save}>
          <label htmlFor="title">Título</label><input ref={titleInput} id="title" name="title" defaultValue={editing?.title ?? ''} maxLength={1000} required placeholder="¿Qué quieres dejar anotado?"/>
          <label htmlFor="kind">Tipo</label><select id="kind" name="kind" defaultValue={editing?.kind ?? 'task'}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <label htmlFor="due">Fecha y hora (opcional)</label><input id="due" name="due" type="datetime-local" defaultValue={editing?.due_at ? new Date(new Date(editing.due_at).getTime() - new Date(editing.due_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}/>
          <button className="primary" disabled={busy || loading} type="submit">{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar registro'}</button>
          {editing && <button type="button" onClick={() => setEditing(null)}>Cancelar edición</button>}
        </form></section>
        <section className="entries" aria-labelledby="entries-title"><div className="section-head"><h2 id="entries-title">Mis registros</h2><button type="button" disabled={loading || more || records.length === 0} onClick={exportRecords}>{more ? 'Carga todo para exportar' : 'Exportar copia'}</button></div><label htmlFor="filter">Mostrar</label><select id="filter" value={kind} onChange={event => setKind(event.target.value)}><option value="all">Todos los tipos</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {loading && <p role="status">Cargando registros…</p>}
          {!loading && !error && visible.length === 0 && <p className="empty">{records.some(record => !record.deleted_at) ? 'No hay registros de este tipo.' : 'Todavía no tienes registros. Anota el primero en el formulario.'}</p>}
          <ul>{visible.map(record => <li key={record.id}><div className="record-copy"><p className="record-meta">{kinds[record.kind]} · {record.status === 'completed' ? 'Completado' : record.status === 'active' ? 'Activo' : record.status}</p><h3 className={record.status === 'completed' ? 'completed' : ''}>{record.title}</h3>{record.due_at && <time dateTime={record.due_at}>{new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.due_at))}</time>}</div><div className="record-actions">{record.kind === 'task' && <button type="button" disabled={busy} aria-label={`${record.status === 'completed' ? 'Reabrir' : 'Completar'} ${record.title}`} onClick={() => void change(record, { status: record.status === 'completed' ? 'active' : 'completed' })}>{record.status === 'completed' ? 'Reabrir' : 'Completar'}</button>}<button type="button" disabled={busy} aria-label={`Editar ${record.title}`} onClick={() => { setEditing(record); titleInput.current?.focus(); }}>Editar</button><button type="button" disabled={busy} aria-label={`Archivar ${record.title}`} onClick={() => void change(record, { deleted_at: new Date().toISOString() })}>Archivar</button></div></li>)}</ul>
          {more && <button type="button" disabled={loading} onClick={() => void load(true)}>Cargar más registros</button>}
          {records.some(record => record.deleted_at) && <details><summary>Archivados</summary><ul>{records.filter(record => record.deleted_at).map(record => <li key={record.id}><span>{record.title}</span><button type="button" disabled={busy} aria-label={`Restaurar ${record.title}`} onClick={() => void change(record, { deleted_at: null })}>Restaurar</button></li>)}</ul></details>}
        </section>
      </div>}
    </main><footer className="footer">Personal OS · Un registro a la vez.</footer>
  </>;
}

if (!localOnly && (location.pathname === '/' || location.pathname.startsWith('/areas/') || ['/study', '/calendar', '/finance', '/goals', '/knowledge', '/projects', '/system'].some(route => location.pathname === route || location.pathname.startsWith(route + '/')))) {
  void import('./workspace/main.js');
} else void import('./style.css').then(() => createRoot(document.getElementById('root')!).render(<App/>));
