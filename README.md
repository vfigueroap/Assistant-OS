# Personal OS

Cuaderno personal con registros, fechas y un módulo de gimnasio basado en openGym. Esta copia está conectada al proyecto Supabase Assistant-OS que ya tiene tu cuenta propietaria. También puedes usar registros locales sin iniciar sesión.

## Abrir esta copia

Haz doble clic en **Iniciar.cmd**. Inicia la versión compilada y abre `http://127.0.0.1:5173`, sin ventanas de terminal permanentes ni servidor de desarrollo. Si ya está abierta, reutiliza el servidor. También puedes ejecutar `npm.cmd start`.

Entra con tu cuenta existente para usar la nube y el gimnasio. **Usar registros de este navegador** conserva el acceso a los registros locales anteriores. Los dos almacenes siguen separados; no hay migración ni borrado automático.

La configuración pública local está en `.env`, excluido de Git. No contiene contraseña ni clave administrativa. La versión web se publica desde `main` de [Assistant-OS](https://github.com/vfigueroap/Assistant-OS) en [Vercel](https://assistant-os-five.vercel.app/). Las variables de Supabase del despliegue se configuran en Vercel.

**Herramientas** conserva estudio, calendario, finanzas, objetivos, conocimiento, proyectos y control de agentes. Comparte la sesión propietaria con el cuaderno y el gimnasio. Sus trabajos automáticos necesitan el worker configurado.

## Desarrollo o instalación nueva

Requiere Node 26 y npm. Desde esta carpeta, en PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abre `http://127.0.0.1:5173`. Un solo comando inicia la web y la API de desarrollo en loopback. No necesitas `.env` para los registros locales. Para preparar otra copia compilada:

```powershell
npm.cmd run build
npm.cmd start
```

El gimnasio se compila desde su snapshot incluido. El primer build instala sus dependencias con su propio lockfile si faltan; requiere acceso a npm. Salidas: `dist/web`, `dist/api` y `dist/gym`. Recompilar web o API conserva los medios del gimnasio. El servidor de uso normal solo necesita Node y las dependencias de producción, sin Vite en ejecución.

## Guardado

- **Sin cuenta configurada:** los registros se guardan en este navegador. Permite crear, editar, completar tareas, archivar, restaurar, filtrar y exportar JSON. El archivo incluye también los archivados. Exporta antes de borrar datos del navegador o cambiar de equipo.
- **Con Supabase configurado:** se usa la sesión de la cuenta propietaria y las políticas RLS de la base. Las ediciones comprueban la versión del registro para evitar sobrescribir cambios ajenos. Carga todas las páginas antes de exportar.
- Los registros locales y los de la cuenta se conservan por separado. Conectar una cuenta no migra ni borra datos locales.
- El modo local necesita un navegador moderno con Web Locks, en localhost o HTTPS. Los errores de almacenamiento se muestran y conservan el formulario; nunca se sustituye un archivo dañado por una lista vacía.
- Archivar conserva el registro. El gimnasio mantiene su transporte de snapshots, hash, revisión y control de conflictos. No se eliminan rutinas, fotos ni backups personales.

## Conectar otra instalación

Estos pasos no hacen falta en esta copia. El proyecto remoto actual tiene migraciones adicionales y propietario configurado. No repitas las migraciones iniciales sobre esa base. El 16 de noviembre se aplicó únicamente `gym_expired_snapshot_cleanup`, que permite al propietario limpiar transferencias expiradas; se comprobó en una transacción con rollback que no permite borrar transferencias vigentes ni datos de otra cuenta.

1. Copia `.env.example` a `.env` y completa la URL y la clave publicable de tu proyecto. Nunca uses una clave secreta en `VITE_*`.
2. Aplica las migraciones de `supabase/migrations` solo a una instalación nueva que tú administras; conserva el historial de una instalación existente.
3. Crea la cuenta propietaria en Supabase Auth. Para registrar esa cuenta, configura `SETUP_OWNER_ID` y `SUPABASE_SECRET_KEY` o su variante `_FILE`, y ejecuta `npm.cmd run setup`. Este comando cambia permisos de esa base; no es necesario para modo local.
4. Retira la clave administrativa del entorno normal y reinicia `npm.cmd run dev`. Entra desde **Conexión**. El gimnasio comparte esta sesión.

`APP_ORIGIN` debe coincidir con la URL del portal, incluido puerto. `API_PORT` cambia el puerto interno de la API. La API no publica claves administrativas ni acepta un usuario distinto del propietario. Las credenciales de plugins de Codex no se exportan a esta aplicación.

## Worker y extracción

El worker es opcional. Usa una cuenta independiente registrada con `SETUP_WORKER_ID`, ámbitos mínimos y un archivo de contraseña fuera del repositorio. Inicia con `npm.cmd run worker`. Sin credenciales válidas, termina con un error de configuración. Telegram, Gmail e inferencia externa permanecen desactivados por defecto.

`services/extractor` contiene el servicio Python aislado y su Dockerfile. Acepta documentos compatibles, conserva localizadores y avisa si hace falta OCR; no infiere páginas ilegibles. No se inició Docker ni se configuraron cuentas externas durante esta tarea.

Consulta [operación y respaldo](infra/README.md) para configurar el worker, autorizar conectores y recuperar base y archivos juntos.

En este entorno se verificó la extracción de texto, PDF y Office. El servicio HTTP/OCR necesita las dependencias de su contenedor y Tesseract; no está incluido en Vercel. El worker y el extractor se ejecutan por separado con `infra/compose.yaml` y su configuración privada de `.env.hp`.

## Directorio

```text
apps/       web, api, worker y adaptador gym
packages/   dominio: dinero, agenda, políticas y contratos
services/   extractor de documentos
supabase/   migraciones de base de datos
scripts/    arranque, setup y build de gym
tests/      backend, navegador y transporte gym
vendor/     fuente openGym con sus licencias y lockfile
notices/    condiciones de la integración
```

`dist`, `node_modules`, `.local` y `graphify-out` contienen salidas o recursos de herramientas; el código de la aplicación está en las carpetas anteriores. `AGENTS.md` indica cómo consultar y actualizar el grafo. La dirección visual provisional está en `DESIGN.md`.

## Comprobar

```powershell
npm.cmd run check
$env:PLAYWRIGHT_CHANNEL = 'msedge' # o usa Chromium instalado por Playwright
npm.cmd run test:e2e
python -m unittest discover -s services/extractor -p 'test_*.py'
```

`check` ejecuta TypeScript, compila y después comprueba dominio/web/backend y transporte gym. Las pruebas del servidor necesitan los archivos compilados; por eso la compilación va antes de `npm test`, también en GitHub. Las pruebas de migraciones usan PostgreSQL embebido con sustitución de pgvector para validar RLS y conflictos; no certifican embeddings ni una instancia remota. Las de navegador usan un perfil temporal y datos de prueba, sin acceder a tus cuentas.

El portal conserva verde y papel del manifiesto existente, tipografía del sistema y listas de registros. Consulta la [verificación de preparación](anti-slop/audit-002-2026-11-16.md), además de la [auditoría inicial](anti-slop/audit-001-2026-11-15.md), para resultados y límites.

La fuente y los medios del gimnasio conservan sus condiciones originales: [aviso openGym](notices/OPEN_GYM.md). El build enlaza la fuente de la revisión desplegada en GitHub; `VITE_GYM_SOURCE_URL` permite indicar otra ubicación de esa misma fuente.
