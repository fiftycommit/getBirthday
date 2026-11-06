#!/usr/bin/env bash
# Exécuté sur le serveur comme *commande forcée* de la clé SSH de déploiement (authorized_keys):
#   restrict,command="/home/ubuntu/getBirthday/scripts/deploy.sh" ssh-ed25519 AAAA… getbirthday-deploy
# La CI envoie `deploy <sha>` + l'image Docker (tar gzip) sur stdin. Rien d'autre n'est exécutable avec cette clé.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  local action sha
  read -r action sha <<<"${SSH_ORIGINAL_COMMAND:-}"
  [[ $action == deploy && $sha =~ ^[0-9a-f]{40}$ ]] || { echo "commande refusée" >&2; exit 2; }

  exec 9>.deploy.lock
  flock -n 9 || { echo "déploiement déjà en cours" >&2; exit 3; }

  echo "▶ Réception de l'image $sha"
  gzip -dc | docker load >/dev/null
  docker image inspect "getbirthday:$sha" >/dev/null

  echo "▶ Mise à jour de la config (compose, scripts)"
  git fetch -q origin master
  git reset -q --hard "$sha"

  local previous_sha=""
  [[ -f .deployed_sha ]] && previous_sha=$(<.deployed_sha)

  if docker compose ps -q bot | grep -q .; then
    echo "▶ Sauvegarde pré-déploiement"
    docker compose exec -T bot node src/backup-cli.js || echo "⚠ sauvegarde impossible, on continue"
  fi

  if docker image inspect getbirthday:current >/dev/null 2>&1; then
    docker tag getbirthday:current getbirthday:previous
  fi
  docker tag "getbirthday:$sha" getbirthday:current

  echo "▶ Démarrage"
  docker compose up -d --no-build --remove-orphans

  local cid status="" i
  cid=$(docker compose ps -q bot)
  for i in $(seq 1 24); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo none)
    [[ $status == healthy ]] && break
    sleep 5
  done

  if [[ $status != healthy ]]; then
    echo "✖ Bot non sain ($status), rollback" >&2
    docker compose logs --tail 40 bot >&2 || true
    if docker image inspect getbirthday:previous >/dev/null 2>&1; then
      docker tag getbirthday:previous getbirthday:current
      docker compose up -d --no-build
    fi
    exit 1
  fi

  echo "$sha" > .deployed_sha
  echo "▶ Nettoyage des anciennes images"
  local tag
  for tag in $(docker images getbirthday --format '{{.Tag}}'); do
    [[ $tag =~ ^[0-9a-f]{40}$ && $tag != "$sha" && $tag != "$previous_sha" ]] && docker rmi "getbirthday:$tag" >/dev/null || true
  done
  docker image prune -f >/dev/null
  echo "✔ Déployé $sha"
}

main "$@"
exit
