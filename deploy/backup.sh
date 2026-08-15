#!/usr/bin/env bash
set -euo pipefail

backup_dir=/opt/dispozapi/backups
timestamp=$(date -u +%Y%m%d-%H%M%S)
target="$backup_dir/dispozapi-$timestamp.dump"

install -d -m 700 "$backup_dir"
umask 077

docker exec dispozapi_postgres \
  pg_dump -U dispozapi -d dispozapi -Fc > "$target"

test -s "$target"
find "$backup_dir" -type f -name 'dispozapi-*.dump' -mtime +7 -delete

echo "Backup criado: $target"

