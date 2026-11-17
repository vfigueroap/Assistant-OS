import { useEffect, useRef, useState } from 'react';
import './navigation.css';

export const areas = [
  { id: 'work', group: 'Vida', label: 'Trabajo', sections: [['overview', 'Resumen'], ['opportunities', 'Oportunidades'], ['finance', 'Finanzas'], ['projects', 'Proyectos']] },
  { id: 'health', group: 'Vida', label: 'Salud', sections: [['overview', 'Resumen'], ['gym', 'Gimnasio'], ['stats', 'Estadísticas'], ['upcoming', 'Próximos'], ['plans', 'Planes']] },
  { id: 'spirituality', group: 'Vida', label: 'Espiritualidad', sections: [['overview', 'Resumen'], ['reflections', 'Reflexiones'], ['practices', 'Prácticas'], ['reminders', 'Recordatorios']] },
  { id: 'romantic', group: 'Vida', label: 'Pareja', sections: [['overview', 'Resumen'], ['plans', 'Planes'], ['dates', 'Fechas importantes']] },
  { id: 'family-friends', group: 'Vida', label: 'Familia y amigos', sections: [['overview', 'Resumen'], ['upcoming', 'Próximos encuentros'], ['contacts', 'Contactos']] },
  { id: 'five-buckets', group: 'Desarrollo', label: 'Cinco baldes', sections: [['overview', 'Resumen'], ['knowledge', 'Conocimiento'], ['skills', 'Habilidades'], ['resources', 'Recursos'], ['network', 'Red'], ['reputation', 'Reputación']] },
  { id: 'system', group: 'Sistema', label: 'Sistema', sections: [['overview', 'Resumen'], ['agents', 'Agentes'], ['devices', 'Dispositivos'], ['services', 'Servicios'], ['connections', 'Conexiones'], ['approvals', 'Aprobaciones']] },
  { id: 'business', group: 'Desarrollo', label: 'Negocios', sections: [['overview', 'Resumen'], ['projects', 'Proyectos'], ['sales', 'Ventas'], ['marketing', 'Marketing']] },
  { id: 'education', group: 'Desarrollo', label: 'Educación', sections: [['overview', 'Resumen'], ['studies', 'Estudios'], ['assessments', 'Evaluaciones'], ['materials', 'Materiales']] },
] as const;
export type AreaId = typeof areas[number]['id'];
const legacy: Record<string, [AreaId, string]> = { '/study': ['education', 'studies'], '/finance': ['work', 'finance'], '/projects': ['work', 'projects'], '/goals': ['five-buckets', 'overview'], '/knowledge': ['five-buckets', 'knowledge'], '/system': ['system', 'approvals'], '/calendar': ['health', 'upcoming'] };
export function areaLocation(path = location.pathname): { areaId?: AreaId; section: string } {
  if (path.startsWith('/gym')) return { areaId: 'health', section: 'gym' };
  const match = /^\/areas\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  const area = areas.find(item => item.id === match?.[1]);
  if (area) return { areaId: area.id, section: match?.[2] || 'overview' };
  const alias = legacy[path];
  return alias ? { areaId: alias[0], section: alias[1] } : { section: 'overview' };
}
export function sectionUrl(areaId: string, section = 'overview') { return areaId === 'health' && section === 'gym' ? '/gym/' : `/areas/${areaId}/${section}`; }

export function PersonalNavigation({ areaId, section = 'overview', theme, onThemeChange, gym = false }: { areaId?: AreaId; section?: string; theme?: string; onThemeChange?: () => void; gym?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const area = areas.find(item => item.id === areaId);
  const localOnly = new URLSearchParams(location.search).get('local') === '1';
  const connectionUrl = localOnly ? '/settings?local=1' : '/settings';
  const recordsUrl = localOnly ? '/?local=1' : '/records';
  const homeUrl = localOnly ? '/?local=1' : '/';
  const themeLabel = theme === 'dark' ? 'Tema claro' : 'Tema oscuro';
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!element.open) element.showModal();
    return () => { document.body.style.overflow = oldOverflow; if (element.open) element.close(); };
  }, [open]);
  const close = () => dialog.current?.close();
  const areaLink = (item: typeof areas[number]) => <a key={item.id} href={sectionUrl(item.id)} aria-current={areaId === item.id ? 'page' : undefined} onClick={close}>{item.label}</a>;

  return <div className="pos-navigation" data-gym={gym || undefined}>
    <a className="pos-skip" href={gym ? '#app' : '#main'}>Ir al contenido</a>
    <header className="pos-header">
      <button ref={trigger} className="pos-control pos-menu" type="button" aria-label="Abrir áreas" aria-expanded={open} aria-controls="personal-os-areas" onClick={() => setOpen(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>Áreas</span>
      </button>
      <a className="pos-brand" href={homeUrl}>Personal OS</a>
      {area && <span className="pos-area-name">{area.label}</span>}
      <div className="pos-header-actions">
        <a href={connectionUrl}>Conexión</a>
        {onThemeChange && <button className="pos-control" type="button" aria-label={themeLabel} title={themeLabel} onClick={onThemeChange}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {theme === 'dark'
              ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></>
              : <path d="M20.8 14.6A9 9 0 0 1 9.4 3.2 9 9 0 1 0 20.8 14.6Z"/>}
          </svg>
        </button>}
      </div>
    </header>
    {area && <nav className="pos-sections" aria-label={`Apartados de ${area.label}`}>
      {area.sections.map(([id, label]) => <a key={id} href={sectionUrl(area.id, id)} aria-current={section === id ? 'page' : undefined}>{label}</a>)}
    </nav>}
    <dialog id="personal-os-areas" ref={dialog} className="pos-drawer" aria-label="Áreas de mi vida"
      onClose={() => { setOpen(false); trigger.current?.focus(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX > bounds.right || event.clientY > bounds.bottom) close();
      }}>
      <div className="pos-drawer-heading">
        <strong className="pos-brand">Personal OS</strong>
        <button className="pos-control" type="button" onClick={close} aria-label="Cerrar áreas" title="Cerrar áreas">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <nav aria-label="Áreas principales">
        <a href={homeUrl} aria-current={!areaId && location.pathname === '/' ? 'page' : undefined} onClick={close}>Inicio</a>
        {['Vida', 'Desarrollo'].map(group => <div className="pos-drawer-group" key={group} role="group" aria-label={group}>
          <p className="pos-drawer-label" aria-hidden="true">{group}</p>
          {areas.filter(item => item.group === group).map(areaLink)}
        </div>)}
        <div className="pos-drawer-group">{areas.filter(item => item.group === 'Sistema').map(areaLink)}</div>
      </nav>
      <nav className="pos-drawer-tools" aria-label="Herramientas personales">
        <a href={recordsUrl} onClick={close}>Mis registros</a>
        <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noopener noreferrer" onClick={close}>Google Calendar</a>
        <a href={connectionUrl} onClick={close}>Conexión</a>
      </nav>
    </dialog>
  </div>;
}
