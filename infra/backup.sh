#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?Set the Supabase session pooler connection URL in a private backup environment file}"
: "${RESTIC_REPOSITORY:?Set an encrypted backup destination}"
: "${RESTIC_PASSWORD_FILE:?Keep the restic password outside this repository}"
backup_dir="${BACKUP_STAGING_DIR:-/var/lib/assistant-os/backup-staging}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$backup_dir/assistant-os-$stamp.dump"
trap 'rm -f -- "$dump"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$dump" "$DATABASE_URL"
restic backup --tag assistant-os-db "$dump"
restic check
printf 'Backup cifrado y verificado: %s\n' "$stamp"
