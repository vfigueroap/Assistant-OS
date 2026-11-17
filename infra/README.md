# Worker, Hermes y respaldo

El portal de Vercel muestra la última información publicada aunque el HP esté apagado. La cola, los conectores y OCR necesitan un equipo con Docker y su configuración privada; publicar los repositorios no los activa. Hermes se instala desde su proyecto oficial y usa el catálogo del repositorio [Agents](https://github.com/vfigueroap/Agents).

## Iniciar o actualizar el worker

En una copia del repositorio en el equipo que procesará los trabajos:

```sh
cp .env.hp.example .env.hp
chmod 600 .env.hp
docker compose --env-file .env.hp -f infra/compose.yaml build
docker compose --env-file .env.hp -f infra/compose.yaml up -d
docker compose --env-file .env.hp -f infra/compose.yaml logs --tail=100 worker extractor
```

Completa `.env.hp` antes de iniciar: URL y clave publicable de Supabase, `WORKER_OWNER_ID`, `WORKER_EMAIL` y contraseña dedicada o `WORKER_PASSWORD_FILE`. El usuario Auth del worker debe ser distinto del propietario y estar registrado con los ámbitos mínimos mediante `private.register_worker` o el setup documentado en el README principal. No uses la clave administrativa en el worker.

La nueva publicación necesita el ámbito `dashboard.publish`; las capturas necesitan `ingest.gmail` o `ingest.telegram`, y los trabajos conservan sus ámbitos por tipo. Aplica antes la migración de dashboard revisada para tu base existente. Nunca repitas las migraciones iniciales sobre el proyecto actual.

El extractor no publica puertos; el worker lo alcanza por la red interna de Compose. En **Sistema**, reanuda los trabajos solo cuando la configuración esté preparada. Los trabajos antiguos sobre archivos guardados en Supabase siguen funcionando. Sus pruebas de extracción necesitan `document.extract`, el extractor y las credenciales del worker.

## Originales locales y bandeja de Hermes

La configuración predeterminada es `CAPTURE_STORAGE=local`. Gmail y el bot opcional de capturas conservan el original, su manifiesto y el texto extraído en `captures` del HP. La nube recibe únicamente metadatos, una referencia opaca `sha256:…` y los campos estructurados del borrador financiero. No se publica un fragmento del correo como resumen. Hermes puede leer el resultado local y preparar un resumen mediante su skill de publicación. `CAPTURE_STORAGE=cloud` conserva expresamente el transporte anterior con originales en Storage; no es el modo híbrido recomendado.

Configura `HOMELAB_DATA_DIR=/srv/personal-os` y prepara los permisos con el instalador del repositorio Agents antes de iniciar Compose. El bind mount exige que el directorio exista y lo presenta al worker como `/homelab`:

| Directorio host | Uso y permisos |
| --- | --- |
| `inbox` | Hermes publica UUID `.json` mediante escritura atómica; grupo compartido `personal-os`, modo `2770` |
| `inbox/processed` | Entregas confirmadas, duplicadas o anteriores a la publicada; archivo técnico conservado |
| `inbox/quarantine` | Entregas inválidas o rechazadas definitivamente, con motivo sin contenido sensible |
| `captures` | Propietario UID 1000, grupo `HOMELAB_GROUP_ID` (2000), modo `2750`; originales y extracciones `0640` para lectura de Hermes |
| `control` | Propietario worker y grupo compartido, modo `2750`; política de pausa `0640`, sin credenciales |

Las credenciales y la sesión de Supabase permanecen en `.env.hp` y el volumen privado `/state`, sin compartirlos con Hermes. Los perfiles no acreditan aislamiento del sistema operativo; el instalador debe limitar la escritura de Hermes a su estado, reportes y bandeja, dejando `captures` y `control` en lectura.

El worker admite entregas JSON v1 de hasta 256 KiB, valida el contrato y las publica mediante `publish_dashboard`. No sigue enlaces simbólicos ni lee rutas indicadas por un archivo. Ante un fallo de red conserva el JSON para reintentar; solo lo archiva después de una respuesta explícita. Las entregas aceptadas se actualizan por fuente y fecha sin repetir efectos. Los archivos de `processed`, cuarentena y capturas no se borran automáticamente: inclúyelos en el respaldo y revisa su crecimiento. La telemetría cada 30 segundos produce hasta 2880 entregas técnicas al día.

Cada 30 segundos se consulta `worker_runtime_policy` y se escribe atómicamente `control/runtime-policy.json`. El dispatcher Hermes requiere una política de lectura y propuestas, no pausada y observada en los últimos 90 segundos, antes de iniciar un modelo. Si falta o caduca se detiene la inferencia; la telemetría continúa. Un error al actualizar esa política no descarta entregas pendientes.

Hermes inicia sesión mediante su opción **ChatGPT or Codex Subscription**, en su usuario del HP. No copies tokens a este repositorio ni actives `EXTERNAL_AI_ENABLED` para usar la suscripción. La inferencia del worker anterior permanece desactivada; el publicador y la telemetría no usan LLM.

## Google y Telegram

Los conectores están desactivados por defecto. `.env.hp.example` enumera sus parámetros. Para Gmail, define `GMAIL_LABEL_IDS` y remitentes exactos en `GMAIL_ALLOWED_SENDERS`. Las etiquetas sin entrada en `GMAIL_LABEL_AREAS` son evidencia financiera; por ejemplo, `{"Label_Work":"work","Label_University":"education"}` las clasifica como documentos de Trabajo o Educación. Solo se procesan mensajes que cumplan etiqueta y remitente. El permiso OAuth `gmail.readonly` permite leer el buzón completo aunque el programa filtre estas listas.

Ejecuta `node scripts/authorize-google.mjs gmail` o `node scripts/authorize-google.mjs calendar` desde el HP. El flujo interactivo guarda el refresh token localmente sin mostrarlo. Por SSH, prepara el túnel que indica el comando para completar la autorización en un navegador de confianza. Los archivos `_FILE` permiten mantener secretos fuera del repositorio.

Calendar solicita solamente `calendar.events.readonly`. Configura tu calendario existente, por ejemplo `GOOGLE_CALENDAR_CONNECTIONS=[{"id":"personal","calendarId":"primary","systemOwned":false}]`, y programa `calendar.sync` desde Sistema con esa conexión. La primera consulta abarca los últimos 30 días y los próximos 180, expandiendo recurrencias; continúa por cursor y renueva la ventana diariamente. No elimina el historial almacenado fuera de ella ni trunca silenciosamente lotes grandes. Los eventos cancelados pueden llegar sin fechas y se conservan como cancelaciones. La consulta no crea otro calendario.

`CALENDAR_WRITES_ENABLED=false` bloquea las escrituras incluso con una sesión antigua que conserve permisos. El transporte anterior de acciones aprobadas sigue disponible solo con activación expresa y un calendario de la aplicación; el onboarding nuevo no concede ese permiso.

El bot principal de Telegram pertenece al gateway Hermes. Mantén `TELEGRAM_ENABLED=false` en este worker, salvo que configures **otro bot** exclusivamente para capturas. Nunca uses el mismo token en ambos procesos: Telegram no admite dos consumidores de `getUpdates` y los webhooks también son excluyentes. El bot opcional sigue restringido al usuario y chat privados configurados; `/documento` registra un documento y los demás mensajes se consideran comprobantes pendientes de revisión.

## Respaldar y restaurar

Antes de actualizar, pausa agentes y respalda. `backup.sh` conserva juntos el dump PostgreSQL y los objetos privados de `personal-files` en restic cifrado; necesita `pg_dump`, `rclone` y `restic`. Configura en un archivo privado separado de `.env.hp`:

```sh
DATABASE_URL='conexión PostgreSQL'
RESTIC_REPOSITORY='/ruta/al/respaldo'
RESTIC_PASSWORD_FILE='/ruta/privada/clave-restic'
RCLONE_CONFIG_SUPABASE_TYPE='s3'
RCLONE_CONFIG_SUPABASE_PROVIDER='Other'
RCLONE_CONFIG_SUPABASE_ENDPOINT='https://TU_PROYECTO.storage.supabase.co/storage/v1/s3'
RCLONE_CONFIG_SUPABASE_REGION='REGIÓN_DEL_PROYECTO'
RCLONE_CONFIG_SUPABASE_FORCE_PATH_STYLE='true'
RCLONE_CONFIG_SUPABASE_ACCESS_KEY_ID='clave S3 de Storage'
RCLONE_CONFIG_SUPABASE_SECRET_ACCESS_KEY='secreto S3'
```

Ejecuta `sh infra/backup.sh` con ese entorno cargado. Las claves S3 omiten RLS: resérvalas para el respaldo, nunca para Vercel o el worker. El script descarga todos los objetos en cada ejecución; ajusta la frecuencia al volumen y a las cuotas reales. Conserva una copia de recuperación de la contraseña restic fuera de ese equipo.

Restaura primero con `restic restore` a una carpeta separada, revisa el dump con `pg_restore --list` y prueba base y objetos en un proyecto aislado. Mantén el worker pausado, verifica propietario, RLS y referencias de archivos antes de reanudar. No se ha ejecutado un ciclo de restauración con datos personales como parte de esta publicación.
