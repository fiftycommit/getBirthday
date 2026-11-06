// Smoke test exécuté par la CI *dans l'image de production*, avec les mêmes contraintes que le compose
// (utilisateur non-root, système de fichiers en lecture seule, /tmp en tmpfs, ./data monté).
// Vérifie que l'image démarre réellement: imports, SQLite, écriture disque, sauvegarde, rendu d'annonce.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { buildAnnouncement } from './announce.js';
import { runBackup } from './backup.js';
import { commandDefinitions } from './commands.js';
import { deleteBirthday, getBirthday, setBirthdayDate, setBirthdayMessage } from './db.js';
import './scheduler.js';

assert.deepEqual(commandDefinitions.map((c) => c.name), ['anniversaire', 'anniversaire-config']);

setBirthdayDate('smoke', 'u1', 29, 2, null);
setBirthdayMessage('smoke', 'u1', 'Salut {nom} {user} @everyone');
const birthday = getBirthday('smoke', 'u1');
const payload = buildAnnouncement({ birthday, config: null, name: 'Smoke', year: 2026 });
assert.equal(payload.content, 'Salut Smoke <@u1> @everyone');
assert.deepEqual(payload.allowedMentions, { users: ['u1'] });

const backup = runBackup();
const copy = new DatabaseSync(path.join(backup, 'birthdays.db'), { readOnly: true });
assert.equal(copy.prepare('SELECT count(*) AS n FROM birthdays WHERE guild_id = ?').get('smoke').n, 1);
copy.close();

deleteBirthday('smoke', 'u1');
writeFileSync('/tmp/smoke-probe', 'ok'); // /tmp doit être inscriptible (healthcheck)
console.log('smoke ok');
process.exit(0);
