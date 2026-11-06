#!/usr/bin/env bash
# Restaure une sauvegarde: scripts/restore.sh [nom]   (sans argument: liste; "latest": la plus récente)
# Les données actuelles sont conservées dans data/pre-restore-<horodatage>/ (rien n'est détruit).
set -euo pipefail
cd "$(dirname "$0")/.."

mapfile -t backups < <(ls -1 data/backups 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$' | sort)
if [[ $# -eq 0 ]]; then printf '%s\n' "${backups[@]:-}"; exit 0; fi
[[ ${#backups[@]} -gt 0 ]] || { echo "aucune sauvegarde" >&2; exit 1; }

name=$1
[[ $name == latest ]] && name=${backups[-1]}
src=data/backups/$name
[[ -f $src/birthdays.db ]] || { echo "sauvegarde introuvable: $name" >&2; exit 1; }

aside=data/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)
docker compose stop bot
mkdir -p "$aside"
mv -f data/birthdays.db data/birthdays.db-wal data/birthdays.db-shm data/media "$aside"/ 2>/dev/null || true
cp -a "$src/birthdays.db" data/birthdays.db
cp -a "$src/media" data/media
docker compose up -d --no-build
echo "✔ Restauré $name (ancien état: $aside)"
