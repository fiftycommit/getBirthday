#!/usr/bin/env bash
# Exécuté sur le serveur comme *commande forcée* de la clé SSH de déploiement (authorized_keys):
#   restrict,command="/home/ubuntu/getBirthday/scripts/deploy.sh" ssh-ed25519 AAAA… getbirthday-deploy
# La CI envoie `deploy <sha>` et, sur la 1re ligne de stdin, un token GHCR éphémère (celui du job, valide le temps du job).
# L'image est tirée du registre: seules les couches modifiées sont téléchargées (en pratique: la couche `src`, quelques Ko).
set -euo pipefail

IMAGE_REPO=ghcr.io/fiftycommit/getbirthday

main() {
  cd "$(dirname "$0")/.."
  local action sha token
  read -r action sha <<<"${SSH_ORIGINAL_COMMAND:-}"
  [[ $action == deploy && $sha =~ ^[0-9a-f]{40}$ ]] || { echo "commande refusée" >&2; exit 2; }
  IFS= read -r token
  [[ -n $token ]] || { echo "token manquant" >&2; exit 2; }

  exec 9>.deploy.lock
  flock -n 9 || { echo "déploiement déjà en cours" >&2; exit 3; }

  echo "▶ Pull $IMAGE_REPO:$sha"
  # Config Docker jetable: le token n'est jamais écrit dans ~/.docker.
  local cfg; cfg=$(mktemp -d)
  printf '%s' "$token" | DOCKER_CONFIG=$cfg docker login ghcr.io -u github-actions --password-stdin >/dev/null
  DOCKER_CONFIG=$cfg docker pull -q "$IMAGE_REPO:$sha" >/dev/null
  rm -rf "$cfg"

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
  docker tag "$IMAGE_REPO:$sha" getbirthday:current

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
  echo "▶ Nettoyage: on garde la version courante et la précédente (rollback)"
  local ref
  for ref in $(docker images --format '{{.Repository}}:{{.Tag}}'); do
    if [[ $ref =~ ^($IMAGE_REPO|getbirthday):[0-9a-f]{40}$ && $ref != *":$sha" && $ref != *":$previous_sha" ]]; then
      docker rmi "$ref" >/dev/null || true
    fi
  done
  docker image prune -f >/dev/null
  echo "✔ Déployé $sha"
}

main "$@"
exit
