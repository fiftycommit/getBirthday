# getBirthday

Bot Discord d'anniversaires: chacun enregistre sa date, personnalise son message et son média (image, gif, vidéo ou lien), le bot l'annonce le jour J. Tout se fait avec des boutons, sans connaître une seule commande.

## Installation

1. Créer l'application sur https://discord.com/developers/applications → Bot → copier le token.
2. Inviter le bot avec les scopes `bot applications.commands` et les permissions *Voir les salons*, *Envoyer des messages*, *Joindre des fichiers*, *Intégrer des liens*.
3. `cp .env.example .env`, remplir `DISCORD_TOKEN` et `DISCORD_CLIENT_ID` (`DISCORD_GUILD_ID` pour un déploiement instantané des commandes en dev).
4. `npm install && npm start` (Node ≥ 22.5; aucune intention privilégiée requise).
5. Sur le serveur: `/anniversaire-config salon:#anniversaires` puis `/anniversaire-panneau` dans le salon où poster le panneau.

## Parcours membre

1. Clic sur **🎂 Ajouter mon anniversaire** (panneau) → **sélecteur de date**: listes déroulantes mois / jour (+ année facultative), ou bouton **✍️ Écrire la date** (`06/11/2000`, `6 novembre`…).
2. Un message **visible par lui seul** apparaît: l'aperçu exact de l'annonce (phrase par défaut incluse) et des boutons **✏️ Modifier mon message**, **🖼️ Ajouter un média**, **📅 Changer la date**, **🗑️ Tout supprimer** (avec confirmation).
3. **Média**: *🎞️ Choisir un GIF* (le bot écrit en message privé, le membre utilise le vrai bouton GIF/sticker de Discord, le message se met à jour tout seul), *📤 Depuis mon appareil* (image, GIF, vidéo ≤ 10 Mo) ou *🔗 Avec un lien*.
4. Chaque action met à jour ce même message: l'aperçu est toujours à jour.

Discord n'expose ni son sélecteur GIF/stickers ni de calendrier aux bots: d'où le passage par les messages privés pour les GIF (le contenu des MP est lisible sans intention privilégiée) et les listes déroulantes pour la date. Les stickers animés (Lottie) ne sont pas supportés.

Variables du message: `{user}` (mention), `{nom}`, `{age}`, `{date}`.

## Commandes

| Commande | Rôle |
|---|---|
| `/anniversaire` | Ouvre le même parcours que le panneau |
| `/anniversaires` | Les prochains anniversaires |
| `/anniversaire-panneau [salon]` | Admin: poste le panneau |
| `/anniversaire-config` | Admin: salon des annonces, heure, fuseau, message par défaut |

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
