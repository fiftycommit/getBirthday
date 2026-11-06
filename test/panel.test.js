import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fakeInteraction, useTempDataDir } from './helpers.js';

useTempDataDir();
const db = await import('../src/db.js');
const { handleInteraction } = await import('../src/commands.js');
const { ID } = await import('../src/panel.js');

const run = async (args) => {
  const f = fakeInteraction(args);
  await handleInteraction(f.interaction);
  return f;
};
const button = (customId, extra = {}) => run({ kind: 'button', customId, ...extra });
const modal = (customId, fields, extra = {}) => run({ kind: 'modal', customId, fields, ...extra });
const ids = (payload) => payload.components.flatMap((r) => r.components.map((c) => c.data.custom_id));

test('nouveau membre: le bouton du panneau ouvre la saisie de date, rien n\'est créé', async () => {
  const f = await button(ID.open, { guildId: 'p1' });
  assert.equal(f.last('showModal').data.custom_id, ID.modalDate);
  assert.equal(db.getBirthday('p1', 'U'), undefined);
});

test('date saisie librement → enregistrée, nouveau message privé avec aperçu et actions', async () => {
  const f = await modal(ID.modalDate, { date: '6 novembre 2000' }, { guildId: 'p2' }); // vient du panneau public
  assert.deepEqual(f.calls.map((c) => c.type), ['reply']);
  assert.equal(f.last('reply').flags, 64);
  assert.match(f.last('reply').content, /6 novembre 2000/);
  assert.match(f.last('reply').content, /> 🎂 Joyeux anniversaire <@U>/); // phrase par défaut dans l'aperçu
  assert.deepEqual(ids(f.last('reply')), [ID.text, ID.media, ID.date, ID.del]);
  assert.equal(db.getBirthday('p2', 'U').month, 11);
});

test('date invalide ou illisible: refus clair, bouton Réessayer, rien d\'enregistré', async () => {
  for (const date of ['31/02', 'blabla', '29/02/2001']) {
    const f = await modal(ID.modalDate, { date }, { guildId: 'p3' });
    assert.match(f.last('reply').content, /❌/);
    assert.deepEqual(ids(f.last('reply')), [ID.date]);
  }
  assert.equal(db.getBirthday('p3', 'U'), undefined);
});

test('depuis le tableau de bord, la mise à jour se fait sur place (update, pas de nouveau message)', async () => {
  db.setBirthdayDate('p4', 'U', 1, 1, null);
  const f = await modal(ID.modalDate, { date: '02/02' }, { guildId: 'p4', fromEphemeral: true });
  assert.deepEqual(f.calls.map((c) => c.type), ['update']);
  assert.deepEqual(f.last('update').attachments, []);
  assert.equal(db.getBirthday('p4', 'U').day, 2);
});

test('texte: le champ montre le défaut; le garder ou le vider suit le défaut, un texte perso est stocké', async () => {
  db.setBirthdayDate('p5', 'U', 6, 11, 2000);
  const open = await button(ID.text, { guildId: 'p5', fromEphemeral: true });
  const input = open.last('showModal').toJSON().components[0].component;
  assert.match(input.value, /Joyeux anniversaire \{user\}/);

  await modal(ID.modalText, { text: 'Bravo {nom} pour tes {age} ans !' }, { guildId: 'p5', fromEphemeral: true });
  assert.equal(db.getBirthday('p5', 'U').message, 'Bravo {nom} pour tes {age} ans !');

  const f = await button(ID.textReset, { guildId: 'p5', fromEphemeral: true });
  assert.equal(db.getBirthday('p5', 'U').message, null);
  assert.match(f.last('update').content, /Joyeux anniversaire/);

  await modal(ID.modalText, { text: '🎂 Joyeux anniversaire {user} ! 🎉' }, { guildId: 'p5', fromEphemeral: true });
  assert.equal(db.getBirthday('p5', 'U').message, null);
});

test('aperçu: l\'âge est celui de la prochaine occurrence, variables rendues', async () => {
  const year = new Date().getFullYear();
  db.setBirthdayDate('p6', 'U', 1, 1, year - 20); // 1er janvier passé → prochain = l'an prochain → 21 ans
  db.setBirthdayMessage('p6', 'U', '{nom} aura {age} ans');
  const f = await button(ID.open, { guildId: 'p6' });
  const now = new Date();
  const expected = now.getMonth() === 0 && now.getDate() === 1 ? 20 : 21;
  assert.match(f.last('reply').content, new RegExp(`> User aura ${expected} ans`));
});

test('média: fichier XOR lien; lien invalide refusé; lien http(s) enregistré et affiché dans l\'aperçu', async () => {
  db.setBirthdayDate('p7', 'U', 6, 11, null);
  const none = await modal(ID.modalMedia, { url: '' }, { guildId: 'p7', fromEphemeral: true });
  assert.match(none.last('reply').content, /soit un fichier/);

  const bad = await modal(ID.modalMedia, { url: 'javascript:alert(1)' }, { guildId: 'p7', fromEphemeral: true });
  assert.match(bad.last('followUp').content, /invalide/);
  assert.equal(db.getBirthday('p7', 'U').media_url, null);

  const ok = await modal(ID.modalMedia, { url: 'https://tenor.com/x' }, { guildId: 'p7', fromEphemeral: true });
  assert.deepEqual(ok.calls.map((c) => c.type), ['deferUpdate', 'editReply']);
  assert.match(ok.last('editReply').content, /> https:\/\/tenor\.com\/x/);
  assert.ok(ids(ok.last('editReply')).includes(ID.mediaRemove));
});

test('média: fichier téléchargé et copié localement; le remplacer supprime l\'ancien fichier', async () => {
  db.setBirthdayDate('p8', 'U', 6, 11, null);
  const fetchMock = mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('gif').buffer }));
  const file = { url: 'https://cdn.example/x.gif', contentType: 'image/gif', size: 3 };

  const f1 = await modal(ID.modalMedia, { url: '' }, { guildId: 'p8', fromEphemeral: true, files: [file] });
  const first = db.getBirthday('p8', 'U').media_path;
  assert.ok(existsSync(path.join(db.MEDIA_DIR, first)));
  assert.equal(f1.last('editReply').files.length, 1);

  await modal(ID.modalMedia, { url: 'https://tenor.com/y' }, { guildId: 'p8', fromEphemeral: true });
  assert.ok(!existsSync(path.join(db.MEDIA_DIR, first)));
  assert.equal(db.getBirthday('p8', 'U').media_path, null);
  fetchMock.mock.restore();
});

test('média: type non supporté ou trop lourd refusé sans rien changer', async () => {
  db.setBirthdayDate('p9', 'U', 6, 11, null);
  const exe = await modal(ID.modalMedia, { url: '' }, { guildId: 'p9', fromEphemeral: true, files: [{ url: 'u', contentType: 'application/pdf', size: 1 }] });
  assert.match(exe.last('followUp').content, /Format non supporté/);
  const big = await modal(ID.modalMedia, { url: '' }, { guildId: 'p9', fromEphemeral: true, files: [{ url: 'u', contentType: 'video/mp4', size: 50 * 1024 * 1024 }] });
  assert.match(big.last('followUp').content, /trop lourd/);
  assert.equal(db.getBirthday('p9', 'U').media_path, null);
});

test('suppression: confirmation obligatoire, annulation possible', async () => {
  db.setBirthdayDate('p10', 'U', 6, 11, null);
  const ask = await button(ID.del, { guildId: 'p10', fromEphemeral: true });
  assert.deepEqual(ids(ask.last('update')), [ID.delConfirm, ID.delCancel]);
  assert.ok(db.getBirthday('p10', 'U'));

  const cancel = await button(ID.delCancel, { guildId: 'p10', fromEphemeral: true });
  assert.ok(ids(cancel.last('update')).includes(ID.text));
  assert.ok(db.getBirthday('p10', 'U'));

  await button(ID.delConfirm, { guildId: 'p10', fromEphemeral: true });
  assert.equal(db.getBirthday('p10', 'U'), undefined);
});

test('les données restent isolées par serveur', async () => {
  await modal(ID.modalDate, { date: '1/5' }, { guildId: 'iso-A' });
  assert.ok(db.getBirthday('iso-A', 'U'));
  assert.equal(db.getBirthday('iso-B', 'U'), undefined);
});

test('prochains anniversaires: liste sans ping', async () => {
  db.setBirthdayDate('p11', 'u1', 6, 11, null);
  const f = await button(ID.upcoming, { guildId: 'p11' });
  assert.match(f.last('reply').content, /<@u1>/);
  assert.deepEqual(f.last('reply').allowedMentions, { parse: [] });
});

test('/anniversaire-panneau: poste le panneau avec ses 2 boutons, refuse si permissions manquantes', async () => {
  const sent = [];
  const mkChannel = (allowed) => ({ permissionsFor: () => ({ has: () => allowed }), send: async (p) => { sent.push(p); } });

  const bad = await run({ commandName: 'anniversaire-panneau', channel: mkChannel(false) });
  assert.match(bad.last('reply').content, /Permissions manquantes/);
  assert.equal(sent.length, 0);

  const ok = await run({ commandName: 'anniversaire-panneau', guildId: 'pan', channel: mkChannel(true) });
  assert.equal(sent.length, 1);
  assert.deepEqual(ids(sent[0]), [ID.open, ID.upcoming]);
  assert.match(ok.last('reply').content, /Panneau posté/);
});

test('config: fuseau inconnu refusé, valeurs affichées', async () => {
  assert.match((await run({ commandName: 'anniversaire-config', opts: { fuseau: 'Mars/Olympus' } })).text(), /Fuseau inconnu/);
  assert.match((await run({ commandName: 'anniversaire-config', opts: { heure: 8, fuseau: 'Europe/Paris' } })).text(), /8h \(Europe\/Paris\)/);
});

test('erreur interne: réponse générique, pas de crash', async () => {
  const f = fakeInteraction({ kind: 'button', customId: ID.date });
  f.interaction.showModal = async () => { throw new Error('boom'); };
  const orig = console.error; console.error = () => {};
  await handleInteraction(f.interaction);
  console.error = orig;
  assert.match(f.text(), /Erreur interne/);
});
