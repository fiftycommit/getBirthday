# getBirthday

Bot Discord d'anniversaires: chacun enregistre sa date, personnalise son message et son média (image, gif, vidéo ou lien), le bot l'annonce le jour J.

## Installation

1. Créer l'application sur https://discord.com/developers/applications → Bot → copier le token.
2. Inviter le bot avec les scopes `bot applications.commands` et les permissions *Voir le salon*, *Envoyer des messages*, *Joindre des fichiers*.
3. `cp .env.example .env`, remplir `DISCORD_TOKEN` et `DISCORD_CLIENT_ID` (`DISCORD_GUILD_ID` pour un déploiement instantané des commandes en dev).
4. `npm install && npm start` (Node ≥ 22.5; aucune intention privilégiée requise).

## Commandes

| Commande | Rôle |
|---|---|
| `/anniversaire date jour mois [annee]` | Enregistre la date (année optionnelle → âge) |
| `/anniversaire texte message` | Message perso. Variables: `{user}` `{nom}` `{age}` `{date}` |
| `/anniversaire media [fichier] [lien]` | Image/gif/vidéo (≤ 10 Mo, copiée localement) ou lien (Tenor, Giphy, YouTube…) |
| `/anniversaire apercu` | Aperçu privé du message final |
| `/anniversaire voir [membre]` / `prochains` | Consultation |
| `/anniversaire retirer texte\|media\|tout` | Suppression (RGPD-friendly) |
| `/anniversaire-config` | Admin (Gérer le serveur): salon, heure, fuseau, message par défaut |

## Comportement

- Données par serveur, stockées dans `data/` (SQLite + médias). À sauvegarder.
- Annonce à l'heure configurée (9h Europe/Paris par défaut); si le bot était éteint, rattrapage dans la journée. Une seule annonce par an et par personne.
- 29 février: fêté le 28 les années non bissextiles.
- Seul le membre fêté peut être mentionné par un texte perso (`@everyone` neutralisé).
- Un membre qui quitte le serveur voit ses données purgées à son prochain anniversaire.

## Déploiement (CI/CD)

Push sur `master` → tests → build arm64 (cache de couches) → push GHCR → le serveur tire l'image par SSH (clé à commande forcée `scripts/deploy.sh`), sauvegarde, redémarre, attend le healthcheck, rollback automatique si le bot n'est pas sain.
Seules les couches modifiées transitent: un changement de code n'envoie que la couche `src`; les dépendances ne sont renvoyées que si `package-lock.json` change.

Secrets GitHub requis: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`.

## Sauvegardes

Snapshot SQLite + médias (liens physiques, coût disque quasi nul) dans `data/backups/`: 1 par jour, 1 avant chaque déploiement, 30 conservées. `scripts/restore.sh [nom|latest]` restaure (l'ancien état est conservé dans `data/pre-restore-*`).
