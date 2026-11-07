# getBirthday

Bot Discord d'anniversaires: chacun enregistre sa date, personnalise son message et son média (image, gif, vidéo ou lien), le bot l'annonce le jour J. Tout se fait avec des boutons, sans connaître une seule commande.

## Installation

1. Créer l'application sur https://discord.com/developers/applications → Bot → copier le token.
2. Inviter le bot avec les scopes `bot applications.commands` et les permissions *Voir les salons*, *Envoyer des messages*, *Joindre des fichiers*, *Intégrer des liens*.
3. `cp .env.example .env`, remplir `DISCORD_TOKEN` et `DISCORD_CLIENT_ID` (`DISCORD_GUILD_ID` pour un déploiement instantané des commandes en dev).
4. (Optionnel) Configurer `KLIPY_API_KEY` et/ou `GIPHY_API_KEY` dans `.env` pour activer chaque fournisseur indépendamment. Créer les clés depuis les portails [KLIPY](https://docs.klipy.com/) et [GIPHY](https://developers.giphy.com/). La clé KLIPY en mode test est limitée à 100 requêtes/heure; demander l'accès production dans le portail KLIPY.
5. `npm install && npm start` (Node ≥ 22.5; aucune intention privilégiée requise).
6. Sur le serveur: `/anniversaire-config salon:#anniversaires` puis `/anniversaire-panneau` dans le salon où poster le panneau.

## Parcours membre

1. Clic sur **🎂 Mon anniversaire** (panneau) → une fenêtre où il tape sa date librement (`06/11/2000`, `6 novembre`…, année facultative).
2. Un message **visible par lui seul** apparaît avec la date, l'aperçu de l'annonce et les boutons **✏️ Message**, **🖼️ Ajouter un média**, **📅 Date**, **🗑️ Tout supprimer** (avec confirmation).
3. **Média**: choisir **GIF KLIPY** ou **GIF GIPHY** parmi les fournisseurs configurés (grille de 4 GIF recommandés, ◀ ▶ pour parcourir, recherche ou catégories, clic sur le numéro pour choisir). Le changement de fournisseur conserve la recherche et la page de chacun. Sinon, *🎞️ GIF / sticker Discord* (le bot écrit en message privé, le membre utilise le vrai bouton GIF/sticker de Discord), *📤 Depuis mon appareil* (image, GIF, vidéo ≤ 10 Mo) ou *🔗 Avec un lien*.
4. Chaque modification est enregistrée immédiatement. **Enregistrer et fermer** ferme le message privé ; le panneau permet de revenir modifier ses choix.
5. Si l'année est renseignée, le message par défaut du bot indique l'âge. Un message personnalisé ou celui du serveur peut utiliser `{age}`.

Les boutons de retour permettent de revenir aux médias puis au tableau de bord sans enregistrer de changement. Après une erreur de fichier ou de lien, le média précédent est conservé et les deux retours restent accessibles. « Annuler » sur la demande de GIF en message privé désactive cette demande. Les fenêtres Discord se ferment avec « Annuler » ou la croix.

Le bouton **Infos** du panneau présente les crédits et explique les données et leurs destinataires. La suppression du profil efface la base active et le média actif, mais pas les messages Discord ni les copies dans les sauvegardes ou les dossiers `pre-restore-*`. La rotation conserve les 30 dernières sauvegardes, sans limite garantie en jours. L'exploitant doit gérer les demandes concernant ces copies et les éventuelles copies externes.
L’écran Infos est privé et se ferme avec le bouton **Fermer**.

Discord n'expose ni son sélecteur GIF/stickers ni de calendrier aux bots: d'où le passage par les messages privés pour les GIF (le contenu des MP est lisible sans intention privilégiée) et une saisie libre pour la date (une liste Discord est limitée à 25 choix, il en faudrait 31 pour les jours). Les stickers animés (Lottie) ne sont pas supportés.

L'API KLIPY est appelée côté serveur par le bot, avec l'identifiant Discord comme `customer_id`; les résultats sont conservés 15 minutes en mémoire, sans copie des médias. KLIPY exige une autorisation écrite préalable pour les requêtes côté serveur: contacter developers@klipy.com avant d'activer cette intégration, y compris en test. Voir les [conditions d'intégration](https://docs.klipy.com/integration-requirements).

L'API GIPHY est appelée côté serveur avec un filtre de contenu `g`; les résultats sont conservés 15 minutes en mémoire, sans copie des médias. Chaque fournisseur est indépendant: une erreur ne déclenche pas de bascule automatique. Les médias déjà enregistrés restent inchangés.

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
