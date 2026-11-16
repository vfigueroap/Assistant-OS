# Worker, extracción y respaldo

El portal de Vercel funciona sin estos procesos. La cola, los conectores y OCR necesitan un equipo con Docker y la configuración privada correspondiente; publicarlos en GitHub no los activa.

## Iniciar o actualizar el worker

En una copia del repositorio en el equipo que procesará los trabajos:

```sh
cp .env.hp.example .env.hp
chmod 600 .env.hp
docker compose -f infra/compose.yaml build
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml logs --tail=100 worker extractor
```

Completa `.env.hp` antes de iniciar: URL y clave publicable de Supabase, `WORKER_OWNER_ID`, `WORKER_EMAIL` y contraseña dedicada o `WORKER_PASSWORD_FILE`. El usuario Auth del worker debe ser distinto del propietario y estar registrado con los ámbitos mínimos mediante `private.register_worker` o el setup documentado en el README principal. No uses la clave administrativa en el worker.

El extractor no publica puertos. El worker lo alcanza por la red interna de Compose. En **Herramientas → Sistema**, reanuda agentes solo cuando la configuración esté preparada. Sube un documento pequeño en **Estudios** y comprueba que el trabajo termine; si queda en cola, revisa la pausa global, las credenciales y el ámbito `document.extract`.

Los conectores están desactivados por defecto. `.env.hp.example` enumera sus parámetros. Para Gmail, configura una etiqueta financiera y remitentes exactos antes de activar el conector; `node scripts/authorize-google.mjs gmail` autoriza lectura y guarda el refresh token localmente. Ese permiso permite leer el buzón aunque el programa filtre etiquetas. Para Calendar, usa `node scripts/authorize-google.mjs calendar`; autoriza escritura solo para un calendario de la aplicación. Las acciones propuestas requieren aprobación en el portal. Conserva tokens y contraseñas fuera de Git.

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
