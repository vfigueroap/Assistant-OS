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
    <p className="aios-gym-eyebrow">Personal OS · Entrenamiento</p>
    <h1>Accede al gimnasio</h1>
    <p>Accede con la misma cuenta del portal para consultar tus rutinas y guardar tus entrenamientos.</p>
    <a className="aios-gym-button" href={portalLoginUrl()}>Entrar desde el portal</a>
    <p className="aios-gym-note">Si entrenaste sin conexión, tus cambios se conservan en este dispositivo y se sincronizan al volver con tu cuenta.</p>
    <GymSourceFooter />
  </main>
}

const COPY = {
  account: ['Cuenta del portal', 'Tus rutinas y resultados usan la sesión de Personal OS. Puedes revisar la conexión desde los ajustes del portal.'],
  reminders: ['Recordatorios', 'Esta edición no configura recordatorios externos. El temporizador y las alertas locales durante una sesión siguen disponibles en el gimnasio.'],
  integrations: ['Conexiones externas', 'Esta edición no incluye una conexión con Garmin ni con relojes. Las importaciones de archivos siguen disponibles en Datos y copias del gimnasio.'],
  coach: ['Entrenador', 'El Coach original de openGym no está habilitado en esta edición. Puedes crear y editar tus rutinas en el gimnasio.'],
  native: ['Disponible desde el portal', 'Esta edición es una aplicación web. Las funciones de apps nativas y emparejamiento de relojes no están habilitadas aquí.'],
  media: ['Fotos y vídeos personales', 'Esta edición no incluye un servicio para subir originales de fotos y vídeos. Los datos de entrenamiento se sincronizan con la cuenta del portal.'],
  modules: ['Funciones de entrenamiento', 'Rutinas, progresión, esfuerzo, equipamiento, estadísticas y medidas están disponibles en el gimnasio. Las conexiones con relojes y el Coach original no están habilitados.'],
}

export function PortalSettingsPage({ kind = 'native' }) {
  const [title, description] = COPY[kind] || COPY.native
  return <main className="aios-gym-boundary aios-gym-settings">
    <a className="aios-gym-back" href="#/settings">← Ajustes del gimnasio</a>
    <p className="aios-gym-eyebrow">Personal OS</p>
    <h1>{title}</h1>
    <p>{description}</p>
    <a className="aios-gym-button" href="/settings">Ajustes del portal</a>
    <GymSourceFooter />
  </main>
}
