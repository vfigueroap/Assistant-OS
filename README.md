# Assistant OS

Portal personal para agenda, entrenamiento, estudios, finanzas y proyectos. La web vive en Vercel; Supabase conserva identidad, datos y archivos privados; el HP ejecuta sincronizaciones y extracción mediante conexiones salientes.

**Estado de esta entrega:** el portal y el fork de openGym están implementados. Los conectores externos solo funcionan después de autorizar cada cuenta en el HP. No hay cuentas Google, Garmin o Telegram vinculadas de fábrica. El esquema empieza con la ejecución global de agentes pausada. La web y el gimnasio pueden funcionar mientras el HP está apagado.

## Enlaces y estructura

- Código: <https://github.com/vfigueroap/Assistant-OS>
- Supabase: proyecto `Assistant-OS`, región `us-west-2`, referencia `vpubsipbxppjaplhyzgk`.
- Vercel: proyecto `assistant-os` del equipo `bsa`.
- Web: URL asignada por Vercel al primer despliegue; `/gym/` abre el gimnasio.
- `apps/web`: portal React. `apps/api`: API breve para openGym. `apps/worker`: agentes y conectores del HP. `services/extractor`: OCR y lectura de archivos. `supabase/migrations`: esquema y permisos. `vendor/opengym`: código fuente fijado v1.4.4. `infra`: contenedores y backup.

## 1. Primer acceso y propietario

1. En Supabase, abre **Authentication → Providers → Email**. Mantén la confirmación de correo activada. El SMTP de prueba de Supabase tiene límites; si el correo no llega, usa **Authentication → Users → Add user** en el panel para crear tu usuario y confirmar su correo. Nunca pegues contraseñas aquí ni en Git.
2. Abre la web y crea tu cuenta o entra con la cuenta creada. La pantalla mostrará tu UUID de usuario. Copia ese UUID.
3. En **Supabase → SQL Editor**, ejecuta una sola vez, sustituyendo el valor por tu UUID:

   ```sql
   select private.bootstrap_owner('TU_UUID'::uuid);
   ```

   La función mantiene un solo propietario. No uses el UUID de un usuario ajeno. Vuelve a cargar la web; ahora aparecerán tus datos.
4. En **Sistema**, pulsa **Reanudar agentes** solo cuando el HP esté configurado. Tareas, finanzas manuales y gimnasio funcionan aunque los agentes sigan pausados.

La migración inicial ya se aplicó al proyecto citado. Para otra instalación, ejecuta en orden los archivos de `supabase/migrations` con Supabase CLI o SQL Editor. Comprueba las alertas de seguridad y el aislamiento de las tablas antes de abrir el registro.

## 2. Supabase Free y Vercel Hobby

En Vercel, conecta este repositorio GitHub al proyecto `assistant-os`. Usa la raíz del repositorio, Node 26, `npm ci --ignore-scripts` para instalar, `npm run build` para compilar y `dist` como directorio de salida. El archivo `vercel.json` fija esos valores y dirige `/api/` a la función breve. Las variables de entorno del proyecto son:

| Nombre | Valor | Tipo |
|---|---|---|
| `SUPABASE_URL` | `https://vpubsipbxppjaplhyzgk.supabase.co` | pública |
| `SUPABASE_PUBLISHABLE_KEY` | clave `sb_publishable_...` de **Project Settings → API Keys** | pública |

Estas dos variables ya fueron colocadas en el proyecto Vercel conectado. No uses `sb_secret_...` ni la clave `service_role` en la web, el worker o Git. Configura en Supabase **Authentication → URL Configuration** la URL final de Vercel como Site URL y como redirect permitida. Para una copia local añade `http://localhost:5173`. Tras cambiar variables, vuelve a desplegar.

No cambies de plan automáticamente. Supabase Free limita base y archivos; archivos grandes se conservan en el HP y la web solo muestra sus referencias/extractos. Vercel Hobby se usa para el portal personal, no como hosting de un producto comercial.

## 3. Descargar en el HP y arrancar agentes

Requisitos propuestos: HP con CPU de 64 bits, Linux actual, 4 GB de RAM o más para la carga completa, SSD sano, Docker Engine y Compose. Instala Node 26 en el host solo para los flujos iniciales de autorización Google; el worker ordinario corre en Docker. Si el equipo tiene menos memoria, baja concurrencia y procesa documentos de uno en uno; valida el consumo real antes de dejarlo 24/7. El HP no necesita abrir puertos hacia Internet.

```bash
git clone https://github.com/vfigueroap/Assistant-OS.git
cd Assistant-OS
cp .env.hp.example .env.hp
chmod 600 .env.hp
```

En Supabase **Authentication → Users**, crea un segundo usuario solo para el HP con una contraseña larga y distinta. Copia su UUID. En SQL Editor registra sus permisos mínimos:

```sql
select private.register_worker(
  'UUID_DEL_USUARIO_HP'::uuid,
  array['document.extract','finance.extract','calendar.sync','calendar.apply','planner.week','fitness.sync','life.organize','projects.sync','ingest.telegram','ingest.gmail'],
  'HP'
);
```

En `.env.hp`, completa `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `WORKER_OWNER_ID` (UUID del propietario), `WORKER_EMAIL` y `WORKER_PASSWORD`. El archivo queda solo en el HP y Git lo ignora. Si usas Docker Secrets, puedes poner la contraseña en un archivo privado y definir `WORKER_PASSWORD_FILE` en lugar de `WORKER_PASSWORD`.

```bash
docker compose -f infra/compose.yaml build
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml logs -f worker
```

El extractor no publica ningún puerto y solo es alcanzable por el worker. La cola se reclama mediante HTTPS saliente con sesión Auth dedicada; el HP no posee una clave administrativa. Los originales seleccionados se suben al bucket privado `personal-files`.

## 4. Primer trabajo completo

1. Entra al portal como propietario y reanuda agentes en **Sistema**.
2. Ve a **Estudios**, sube un PDF pequeño con texto seleccionable. La web lo guarda directamente en Storage privado y crea `document.extract`.
3. En **Sistema**, el trabajo debe pasar de `queued` a `running` y luego `succeeded`. En **Estudios**, busca una palabra real del PDF: el resultado mostrará documento y localizador.
4. Si queda `queued`, comprueba Docker, credenciales del worker, alcance `document.extract` y pausa global. Si falla, revisa `docker compose ... logs worker` y `extractor`; los logs están diseñados para evitar cuerpos de correo y tokens.
5. Abre `/gym/`, crea una rutina y guarda una sesión. El estado se almacena con revisión atómica en Supabase. Puedes apagar el HP y seguir entrenando o editar finanzas.

## 5. Conectores y autorizaciones

**Telegram.** Crea un bot con BotFather en tu propia cuenta y conserva el token solo en `.env.hp` o un archivo secreto. Habla con el bot desde un chat privado. Obtén los IDs numéricos de tu usuario y chat mediante la API oficial o un método local de confianza y escribe `TELEGRAM_OWNER_USER_ID` y `TELEGRAM_OWNER_CHAT_ID`. Activa `TELEGRAM_ENABLED=true` y reinicia el worker. El bot solo acepta esa pareja de IDs. Usa «Enviar como archivo» para boletas que requieran OCR de mejor calidad. Más de 20 MB: súbelas desde la web. Si el bot tiene un webhook previo, elimínalo manualmente antes de usar polling. Telegram no es un canal de cifrado extremo a extremo; el bot recibe la boleta en su nube.

**Gmail.** Crea un proyecto OAuth propio en Google Cloud, habilita Gmail API y configura un cliente OAuth de tipo **Desktop app** con redirect loopback `http://127.0.0.1:8765/callback`. En Gmail prepara una etiqueta específica para notificaciones financieras. Configura su ID en `GMAIL_LABEL_IDS` y una lista de remitentes exactos en `GMAIL_ALLOWED_SENDERS` (ambos son obligatorios para este conector). Completa `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env.hp` y ejecuta `node scripts/authorize-google.mjs gmail` en el HP. Abre la URL indicada en un navegador de confianza; si accedes al HP por SSH, usa el túnel que muestra el script. Guarda el refresh token automáticamente en `.env.hp`, sin imprimirlo. Activa `GMAIL_ENABLED=true` y reinicia el worker. El scope `gmail.readonly` permite leer todo el buzón aunque el programa filtre la etiqueta: usa una cuenta separada si ese alcance no te conviene. Los tokens de una app OAuth en modo Testing pueden caducar a los siete días. El conector nunca envía, borra ni etiqueta correos.

**Google Calendar.** Habilita Calendar API en el mismo proyecto OAuth. Ejecuta `node scripts/authorize-google.mjs calendar` para conceder lectura de eventos y, si autorizas escritura, `calendar.app.created` para un calendario de la aplicación. Configura el calendario permitido en el HP. Las invitaciones, cancelaciones y cambios externos se proponen en **Sistema** y requieren aprobación vinculada al contenido exacto. Una operación cuyo resultado sea incierto queda en estado `unknown` para reconciliación, no se reintenta a ciegas.

**Garmin.** Si tu cuenta ofrece Garmin Connect Personal API, genera allí una clave propia y guárdala solo en el HP; valida acceso antes de activar la sincronización. La primera versión acepta importaciones de métricas normalizadas; no promete publicar rutinas al reloj. La API personal publicada es de lectura. La importación manual es alternativa cuando la clave no esté disponible.

**GitHub.** Crea una GitHub App instalada solo en los repositorios que elijas, con permisos de lectura de contents/issues/PRs. Para un prototipo puedes usar un PAT fine-grained de solo lectura con vencimiento. Configura el conector del HP. No concedas escritura, shell del host ni acceso a datos de salud a un agente de código.

**WhatsApp.** No está activo. La API oficial exige configuración Business y webhooks. No uses automatización no oficial de WhatsApp Web.

Las integraciones pendientes se muestran como pendientes; un icono en la web no prueba que se haya autorizado una cuenta.

## 6. Datos, finanzas y límites

- En **Finanzas**, registra compras, ingresos, devoluciones, transferencias y pagos de tarjeta. Los importes se guardan como enteros; CLP y USD nunca se suman. Una boleta subida produce evidencia y un borrador para revisión. El gasto confirmado excluye transferencias y pagos de tarjeta propios.
- Una boleta y un correo relacionados son evidencias separadas. La coincidencia ambigua se revisa; no se fusiona por importe y fecha solamente.
- **Estudios** admite archivos seleccionados hasta el límite gratuito de Storage. El extractor aísla PDF, imagen y Office; si no puede leer una página, muestra advertencias en vez de fabricar citas.
- La base de datos y Storage privados están sujetos a las cuotas de Supabase Free. Vigila el panel de uso, y evita cargar fotos o bibliotecas completas en la nube. El worker puede quedar desconectado mientras el portal sigue disponible. Supabase Free puede pausarse por inactividad.
- **Sistema → Pausar agentes** bloquea nuevos trabajos y escrituras externas. La lectura y edición manual continúan.

## 7. Actualizar, logs y respaldo

```bash
git pull --ff-only
docker compose -f infra/compose.yaml build
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs --tail=100 worker extractor
```

Antes de actualizar, pausa agentes y toma un respaldo. `infra/backup.sh` crea un dump de PostgreSQL con `pg_dump`, lo cifra con restic y ejecuta `restic check`. Necesita `DATABASE_URL`, `RESTIC_REPOSITORY` y `RESTIC_PASSWORD_FILE` en un archivo de entorno privado fuera de Git; `pg_dump` y `restic` instalados en el HP. La contraseña restic debe tener una copia de recuperación fuera del HP. Programa el script con systemd timer y prueba `pg_restore` en una base separada. **El script cubre la base de datos, no los objetos de Supabase Storage**: exporta también los documentos y boletas del bucket privado antes de considerar completo un backup. No elimines originales. Calcula el tráfico mensual antes de descargar bases completas diariamente.

Si el worker falla, consulta los logs locales, la cola en **Sistema** y los logs de Supabase/Vercel. Los cambios de esquema están versionados en Git; nunca edites un archivo de migración ya aplicado para actualizar una instalación: crea una migración nueva. Para restaurar, desactiva el worker, restaura base y objetos juntos, verifica RLS y propietario, y solo entonces reanuda agentes.

## 8. Desarrollo y pruebas

```bash
npm ci --ignore-scripts
cp .env.example .env.local
npm run dev:api
# en otra terminal
npm run dev
npm run typecheck
npm test
npm run build
```

El build incluye el fork de openGym. Su código queda fijado al commit `5f5832db56080837b58342ff50f78631dcc63e07`. Consulta [notices/OPEN_GYM.md](notices/OPEN_GYM.md), `vendor/opengym/LICENSE` y `vendor/opengym/NOTICE.md`. Sus medios originales solo se usan dentro de `/gym/`, bajo el aviso de GymVisual; no se envían a modelos ni se reutilizan en otros módulos. Esta adaptación distribuye código AGPL, por lo que el fuente correspondiente debe seguir disponible públicamente mientras se ofrezca la web.

Las pruebas Linux de contenedores se ejecutan en CI. Las cuentas externas no se prueban con credenciales personales en este repositorio.
