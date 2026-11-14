import { portalLoginUrl } from './session.js'
import './portal.css'

const sourceUrl = import.meta.env.VITE_GYM_SOURCE_URL || 'https://github.com/vfigueroap/Assistant-OS'

export function GymSourceFooter() {
  return <footer className="aios-gym-source">
    <a href="/">Volver al portal</a>
    <span>openGym 1.4.4 · <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Código fuente AGPL</a></span>
  </footer>
}

export function PortalLogin() {
  return <main className="aios-gym-boundary">
    <div className="aios-gym-mark" aria-hidden="true">↗</div>
    <p className="aios-gym-eyebrow">ASSISTANT OS · ENTRENAMIENTO</p>
    <h1>Tu gimnasio, contigo.</h1>
    <p>Accede con la misma cuenta del portal para consultar tus rutinas y guardar tus entrenamientos.</p>
    <a className="aios-gym-button" href={portalLoginUrl()}>Entrar desde el portal</a>
    <p className="aios-gym-note">Si entrenaste sin conexión, tus cambios se conservan en este dispositivo y se sincronizan al volver con tu cuenta.</p>
    <GymSourceFooter />
  </main>
}

const COPY = {
  account: ['Una sola cuenta', 'La identidad, seguridad y cierre de sesión se gestionan desde Assistant OS. Tus rutinas y resultados usan la misma cuenta.'],
  reminders: ['Avisos coordinados', 'Los recordatorios se configuran en el portal para respetar tus horarios y evitar avisos duplicados. El temporizador y las alertas locales durante una sesión siguen funcionando aquí.'],
  integrations: ['Tus fuentes, conectadas', 'Garmin y las demás fuentes se conectan en el portal. El agente de entrenamiento utiliza los datos autorizados; las importaciones de archivos siguen en Datos y copias.'],
  coach: ['Tu entrenador personal', 'Las propuestas de entrenamiento y sus permisos se gestionan en el portal, junto con tus objetivos, descanso y calendario.'],
  native: ['Disponible desde el portal', 'Esta edición es una aplicación web. Las funciones de apps nativas y emparejamiento de relojes no están habilitadas aquí.'],
  media: ['Fotos y vídeos personales', 'Los originales y su disponibilidad se gestionan en el portal. El gimnasio web no sube originales pesados dentro de tu perfil de entrenamiento.'],
  modules: ['Funciones de entrenamiento', 'Rutinas, progresión, esfuerzo, equipamiento, estadísticas y medidas están disponibles. Las cuentas, integraciones, avisos y el entrenador se gestionan desde el portal.'],
}

export function PortalSettingsPage({ kind = 'native' }) {
  const [title, description] = COPY[kind] || COPY.native
  const destination = kind === 'coach' ? '/fitness' : '/settings'
  return <main className="aios-gym-boundary aios-gym-settings">
    <a className="aios-gym-back" href="#/settings">← Ajustes del gimnasio</a>
    <p className="aios-gym-eyebrow">ASSISTANT OS</p>
    <h1>{title}</h1>
    <p>{description}</p>
    <a className="aios-gym-button" href={destination}>Abrir en el portal</a>
    <GymSourceFooter />
  </main>
}
