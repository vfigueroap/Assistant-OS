# openGym dentro de Personal AI OS

El módulo de entrenamiento deriva de openGym de Duarte Santos, release v1.4.4,
commit `5f5832db56080837b58342ff50f78631dcc63e07`.

Fuente original: https://github.com/DuarteSantos8/openGym/tree/5f5832db56080837b58342ff50f78631dcc63e07

Se conservan `vendor/opengym/LICENSE` y `vendor/opengym/NOTICE.md`. El código
derivado mantiene la licencia AGPL-3.0-or-later declarada por upstream. La adaptación
usa autenticación compartida, almacenamiento en PostgreSQL, transporte por partes
y un service worker limitado al gimnasio. No envía información a servicios de IA
desde el Coach original ni ejecuta un servidor Node persistente.

La instancia debe configurar `VITE_GYM_SOURCE_URL` con el enlace al código fuente
correspondiente a la versión desplegada, accesible a las personas que la usan. Puede
ser un repositorio privado al que el propietario tenga acceso. La fuente no debe
incluir secretos, backups ni datos personales.

## Medios de ejercicios

Las imágenes y animaciones de Gym visual NO están bajo AGPL. Los archivos originales
de 180 px se mantienen exclusivamente dentro del módulo openGym y con su aviso.
No se reutilizan en el portal, no se publican como un servicio de recursos y no
se envían a modelos de IA. Un uso comercial u otro uso requiere una licencia propia
de Gym visual. Consulte `vendor/opengym/NOTICE.md` para las condiciones completas.

Las fotos y vídeos personales del usuario son distintos de los medios del catálogo.
La adaptación no copia originales pesados dentro del bundle ni del perfil JSON.

## Límites de esta adaptación

Se conservan rutinas, registro de entrenamiento, progresión, estadísticas, peso
corporal y copias/importaciones de datos en el navegador. Las cuentas, permisos,
automatizaciones y avisos se gestionan en el portal. La app nativa, el emparejamiento
de relojes, el servidor MCP de filesystem y el Coach upstream no forman parte del
despliegue web. El estado se sincroniza con revisión y write ID; el servidor debe
validar ambos de forma transaccional.
