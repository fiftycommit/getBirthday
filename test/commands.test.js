import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeInteraction, useTempDataDir } from './helpers.js';

useTempDataDir();
const db = await import('../src/db.js');
const { handleInteraction } = await import('../src/commands.js');

const run = async (args) => {
  const f = fakeInteraction(args);
  await handleInteraction(f.interaction);
  return f.text();
};

test('date invalide refusée et non enregistrée', async () => {
  assert.match(await run({ sub: 'date', opts: { jour: 30, mois: 2 } }), /invalide/);
  assert.match(await run({ sub: 'date', opts: { jour: 29, mois: 2, annee: 2001 } }), /bissextile/);
  assert.equal(db.getBirthday('G', 'U'), undefined);
});

test('texte et média exigent une date enregistrée', async () => {
  assert.match(await run({ guildId: 'G2', sub: 'texte', opts: { message: 'x' } }), /date/);
  assert.match(await run({ guildId: 'G2', sub: 'media', opts: { lien: 'https://a.b/c.gif' } }), /date/);
});

test('les données sont isolées par serveur', async () => {
  await run({ guildId: 'A', sub: 'date', opts: { jour: 1, mois: 5 } });
  assert.ok(db.getBirthday('A', 'U'));
  assert.equal(db.getBirthday('B', 'U'), undefined);
});

test('média: fichier XOR lien, lien http(s) uniquement', async () => {
  await run({ guildId: 'M', sub: 'date', opts: { jour: 1, mois: 5 } });
  assert.match(await run({ guildId: 'M', sub: 'media', opts: {} }), /soit un/);
  assert.match(await run({ guildId: 'M', sub: 'media', opts: { lien: 'javascript:alert(1)' } }), /invalide/);
  assert.match(await run({ guildId: 'M', sub: 'media', opts: { lien: 'pas un lien' } }), /invalide/);
  assert.match(await run({ guildId: 'M', sub: 'media', opts: { lien: 'https://tenor.com/x' } }), /enregistré/);
  assert.equal(db.getBirthday('M', 'U').media_url, 'https://tenor.com/x');
});

test('retirer: texte, puis tout', async () => {
  await run({ guildId: 'R', sub: 'date', opts: { jour: 2, mois: 6 } });
  await run({ guildId: 'R', sub: 'texte', opts: { message: 'yo' } });
  await run({ guildId: 'R', sub: 'retirer', opts: { quoi: 'texte' } });
  assert.equal(db.getBirthday('R', 'U').message, null);
  await run({ guildId: 'R', sub: 'retirer', opts: { quoi: 'tout' } });
  assert.equal(db.getBirthday('R', 'U'), undefined);
});

test('config: fuseau inconnu refusé, valeurs par défaut affichées', async () => {
  assert.match(await run({ command: 'anniversaire-config', opts: { fuseau: 'Mars/Olympus' } }), /Fuseau inconnu/);
  assert.match(await run({ command: 'anniversaire-config', opts: { heure: 8, fuseau: 'Europe/Paris' } }), /8h \(Europe\/Paris\)/);
});

test('erreur interne: réponse générique, pas de crash', async () => {
  const f = fakeInteraction({ sub: 'inexistant' });
  const orig = console.error; console.error = () => {};
  await handleInteraction(f.interaction);
  console.error = orig;
  assert.match(f.text(), /Erreur interne/);
});
