#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?Set the Supabase session pooler connection URL in a private backup environment file}"
: "${RESTIC_REPOSITORY:?Set an encrypted backup destination}"
: "${RESTIC_PASSWORD_FILE:?Keep the restic password outside this repository}"
: "${RCLONE_CONFIG_SUPABASE_TYPE:?Configure a private rclone S3 remote named supabase}"
: "${RCLONE_CONFIG_SUPABASE_ENDPOINT:?Set the Supabase Storage S3 endpoint}"
: "${RCLONE_CONFIG_SUPABASE_REGION:?Set the Supabase Storage region}"
: "${RCLONE_CONFIG_SUPABASE_ACCESS_KEY_ID:?Set the private S3 access key ID}"
: "${RCLONE_CONFIG_SUPABASE_SECRET_ACCESS_KEY:?Set the private S3 secret access key}"
backup_dir="${BACKUP_STAGING_DIR:-/var/lib/assistant-os/backup-staging}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="$(mktemp -d -- "$backup_dir/run-XXXXXXXX")"
trap 'rm -rf -- "$run_dir"' EXIT
dump="$run_dir/assistant-os-$stamp.dump"
pg_dump --format=custom --no-owner --no-acl --file="$dump" "$DATABASE_URL"
rclone copy supabase:personal-files "$run_dir/personal-files" --transfers 2 --checkers 2
printf '%s\n' "$stamp" > "$run_dir/backup-created-utc.txt"
restic backup --tag assistant-os "$run_dir"
restic check
printf 'Base y archivos cifrados y verificados: %s\n' "$stamp"
