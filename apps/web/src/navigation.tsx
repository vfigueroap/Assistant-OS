import { useEffect, useRef, useState } from 'react';
import './navigation.css';

export const areas = [
  { id: 'work', label: 'Trabajo', sections: [['overview', 'Resumen'], ['opportunities', 'Oportunidades'], ['finance', 'Finanzas'], ['projects', 'Proyectos']] },
  { id: 'health', label: 'Salud', sections: [['overview', 'Resumen'], ['gym', 'Gimnasio'], ['stats', 'Estadísticas'], ['upcoming', 'Próximos'], ['plans', 'Planes']] },
  { id: 'spirituality', label: 'Espiritualidad', sections: [['overview', 'Resumen'], ['reflections', 'Reflexiones'], ['practices', 'Prácticas'], ['reminders', 'Recordatorios']] },
  { id: 'romantic', label: 'Pareja', sections: [['overview', 'Resumen'], ['plans', 'Planes'], ['dates', 'Fechas importantes']] },
  { id: 'family-friends', label: 'Familia y amigos', sections: [['overview', 'Resumen'], ['upcoming', 'Próximos encuentros'], ['contacts', 'Contactos']] },
  { id: 'five-buckets', label: 'Cinco baldes', sections: [['overview', 'Resumen'], ['knowledge', 'Conocimiento'], ['skills', 'Habilidades'], ['resources', 'Recursos'], ['network', 'Red'], ['reputation', 'Reputación']] },
  { id: 'system', label: 'Sistema', sections: [['overview', 'Resumen'], ['agents', 'Agentes'], ['devices', 'Dispositivos'], ['services', 'Servicios'], ['connections', 'Conexiones'], ['approvals', 'Aprobaciones']] },
  { id: 'business', label: 'Negocios', sections: [['overview', 'Resumen'], ['projects', 'Proyectos'], ['sales', 'Ventas'], ['marketing', 'Marketing']] },
  { id: 'education', label: 'Educación', sections: [['overview', 'Resumen'], ['studies', 'Estudios'], ['assessments', 'Evaluaciones'], ['materials', 'Materiales']] },
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
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!element.open) element.showModal();
    return () => { document.body.style.overflow = oldOverflow; if (element.open) element.close(); };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="pos-navigation" data-gym={gym || undefined}>
    <a className="pos-skip" href={gym ? '#app' : '#main'}>Ir al contenido</a>
    <header className="pos-header">
      <button ref={trigger} className="pos-menu" type="button" aria-label="Abrir áreas" aria-expanded={open} aria-controls="personal-os-areas" onClick={() => setOpen(true)}><span aria-hidden="true"><i/><i/><i/></span></button>
      <a className="pos-brand" href={homeUrl}>Personal OS</a>
      {area && <span className="pos-area-name">{area.label}</span>}
      <div className="pos-header-actions"><a href={connectionUrl}>Conexión</a>{onThemeChange && <button type="button" onClick={onThemeChange}>Tema {theme === 'dark' ? 'claro' : 'oscuro'}</button>}</div>
    </header>
    {area && <nav className="pos-sections" aria-label={`Apartados de ${area.label}`}>{area.sections.map(([id, label]) => <a key={id} href={sectionUrl(area.id, id)} aria-current={section === id ? 'page' : undefined}>{label}</a>)}</nav>}
    <dialog id="personal-os-areas" ref={dialog} className="pos-drawer" aria-label="Áreas de mi vida" onCancel={close} onClose={close} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX > bounds.right || event.clientY > bounds.bottom) close(); } }}>
      <div className="pos-drawer-heading"><strong>Personal OS</strong><button type="button" onClick={close} aria-label="Cerrar áreas">Cerrar</button></div>
      <nav aria-label="Áreas principales"><a href={homeUrl} aria-current={!areaId && location.pathname === '/' ? 'page' : undefined} onClick={close}>Inicio</a>{areas.map(item => <a key={item.id} href={sectionUrl(item.id)} aria-current={areaId === item.id ? 'page' : undefined} onClick={close}>{item.label}</a>)}</nav>
      <nav className="pos-drawer-tools" aria-label="Herramientas personales"><a href={recordsUrl} onClick={close}>Mis registros</a><a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noopener noreferrer" onClick={close}>Google Calendar</a><a href={connectionUrl} onClick={close}>Conexión</a></nav>
    </dialog>
  </div>;
}
