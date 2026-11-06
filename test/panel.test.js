import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Collection } from 'discord.js';
import { fakeInteraction, useTempDataDir } from './helpers.js';

useTempDataDir();
const db = await import('../src/db.js');
const { handleInteraction } = await import('../src/commands.js');
const { ID, handleDirectMessage } = await import('../src/panel.js');

const run = async (args) => {
  const f = fakeInteraction(args);
  await handleInteraction(f.interaction);
  return f;
};
const button = (customId, extra = {}) => run({ kind: 'button', customId, ...extra });
const select = (customId, value, extra = {}) => run({ kind: 'select', customId, values: [String(value)], fromEphemeral: true, ...extra });
const modal = (customId, fields, extra = {}) => run({ kind: 'modal', customId, fields, ...extra });
const ids = (payload) => payload.components.flatMap((r) => r.components.map((c) => c.data.custom_id).filter(Boolean));
const eph = { fromEphemeral: true };

// ── Date ──

test('nouveau membre: le bouton du panneau ouvre le sélecteur de date, rien n\'est créé', async () => {
  const f = await button(ID.open, { guildId: 'd1' });
  assert.deepEqual(ids(f.last('reply')), [ID.pickMonth, ID.pickDayA, ID.pickDayB, ID.pickYear, ID.dateType, ID.pickOk]);
  assert.equal(f.last('reply').components[3].components[2].data.disabled, true); // « Valider » inactif
  assert.equal(db.getBirthday('d1', 'U'), undefined);
});

test('sélecteur: mois + jour (liste 1-15 ou 16-31) puis Valider enregistre et ouvre le tableau de bord', async () => {
  const g = { guildId: 'd2' };
  await button(ID.open, g);
  await select(ID.pickMonth, 11, g);
  const afterDay = await select(ID.pickDayB, 20, g);
  const valider = afterDay.last('update').components[3].components[2];
  assert.equal(valider.data.disabled, false);
  assert.match(afterDay.last('update').content, /novembre · \*\*Jour:\*\* 20/);

  const ok = await button(ID.pickOk, { ...g, ...eph });
  assert.deepEqual(db.getBirthday('d2', 'U') && [db.getBirthday('d2', 'U').day, db.getBirthday('d2', 'U').month], [20, 11]);
  assert.match(ok.last('update').content, /20 novembre/);
  assert.ok(ids(ok.last('update')).includes(ID.text));
});

test('sélecteur: année facultative (4 chiffres), dates impossibles refusées', async () => {
  const g = { guildId: 'd3' };
  await select(ID.pickMonth, 4, g);
  await select(ID.pickDayB, 31, g); // 31 avril
  assert.match((await button(ID.pickOk, { ...g, ...eph })).last('update').content, /❌ Jour invalide/);
  assert.equal(db.getBirthday('d3', 'U'), undefined);

  await select(ID.pickMonth, 2, g);
  await select(ID.pickDayB, 29, g);
  assert.match((await modal(ID.modalYear, { year: '20x1' }, { ...g, ...eph })).last('update').content, /4 chiffres/);
  await modal(ID.modalYear, { year: '2001' }, { ...g, ...eph });
  assert.match((await button(ID.pickOk, { ...g, ...eph })).last('update').content, /bissextile/);
  await modal(ID.modalYear, { year: '' }, { ...g, ...eph }); // sans année: 29/02 accepté
  await button(ID.pickOk, { ...g, ...eph });
  assert.equal(db.getBirthday('d3', 'U').year, null);
  assert.equal(db.getBirthday('d3', 'U').day, 29);
});

test('saisie libre toujours possible: bouton « Écrire la date », formats variés, erreurs claires', async () => {
  assert.equal((await button(ID.dateType, { guildId: 'd4', ...eph })).last('showModal').data.custom_id, ID.modalDate);

  const f = await modal(ID.modalDate, { date: '6 novembre 2000' }, { guildId: 'd4' }); // depuis le panneau public
  assert.deepEqual(f.calls.map((c) => c.type), ['reply']);
  assert.match(f.last('reply').content, /> 🎂 Joyeux anniversaire <@U>/);

  for (const date of ['31/02', 'blabla', '29/02/2001']) {
    const bad = await modal(ID.modalDate, { date }, { guildId: 'd5' });
    assert.match(bad.last('reply').content, /❌/);
    assert.deepEqual(ids(bad.last('reply')), [ID.dateType]);
  }
  assert.equal(db.getBirthday('d5', 'U'), undefined);
});

test('« Changer la date » depuis le tableau de bord: sélecteur prérempli, mise à jour sur place', async () => {
  db.setBirthdayDate('d6', 'U', 2, 5, 1999);
  const f = await button(ID.date, { guildId: 'd6', ...eph });
  assert.deepEqual(f.calls.map((c) => c.type), ['update']);
  assert.match(f.last('update').content, /mai · \*\*Jour:\*\* 2 · \*\*Année:\*\* 1999/);
});

// ── Texte ──

test('texte: le champ montre le défaut; le garder ou le vider suit le défaut, un texte perso est stocké', async () => {
  db.setBirthdayDate('t1', 'U', 6, 11, 2000);
  const open = await button(ID.text, { guildId: 't1', ...eph });
  assert.match(open.last('showModal').toJSON().components[0].component.value, /Joyeux anniversaire \{user\}/);

  await modal(ID.modalText, { text: 'Bravo {nom} pour tes {age} ans !' }, { guildId: 't1', ...eph });
  assert.equal(db.getBirthday('t1', 'U').message, 'Bravo {nom} pour tes {age} ans !');

  const f = await button(ID.textReset, { guildId: 't1', ...eph });
  assert.equal(db.getBirthday('t1', 'U').message, null);
  assert.match(f.last('update').content, /Joyeux anniversaire/);

  await modal(ID.modalText, { text: '🎂 Joyeux anniversaire {user} ! 🎉' }, { guildId: 't1', ...eph });
  assert.equal(db.getBirthday('t1', 'U').message, null);
});

test('aperçu: l\'âge est celui de la prochaine occurrence, variables rendues', async () => {
  const year = new Date().getFullYear();
  db.setBirthdayDate('t2', 'U', 1, 1, year - 20);
  db.setBirthdayMessage('t2', 'U', '{nom} aura {age} ans');
  const f = await button(ID.open, { guildId: 't2' });
  const now = new Date();
  const expected = now.getMonth() === 0 && now.getDate() === 1 ? 20 : 21;
  assert.match(f.last('reply').content, new RegExp(`> User aura ${expected} ans`));
});

// ── Média ──

test('média: le menu propose GIF, appareil, lien; chaque choix ouvre la bonne fenêtre', async () => {
  db.setBirthdayDate('m1', 'U', 6, 11, null);
  const menu = await button(ID.media, { guildId: 'm1', ...eph });
  assert.deepEqual(ids(menu.last('update')), [ID.mediaGif, ID.mediaFile, ID.mediaLink, ID.back]);
  assert.equal((await button(ID.mediaFile, { guildId: 'm1', ...eph })).last('showModal').data.custom_id, ID.modalMediaFile);
  assert.equal((await button(ID.mediaLink, { guildId: 'm1', ...eph })).last('showModal').data.custom_id, ID.modalMediaLink);
});

test('média par lien: http(s) uniquement, affiché dans l\'aperçu', async () => {
  db.setBirthdayDate('m2', 'U', 6, 11, null);
  const bad = await modal(ID.modalMediaLink, { url: 'javascript:alert(1)' }, { guildId: 'm2', ...eph });
  assert.match(bad.last('followUp').content, /invalide/);
  assert.equal(db.getBirthday('m2', 'U').media_url, null);

  const ok = await modal(ID.modalMediaLink, { url: 'https://tenor.com/x' }, { guildId: 'm2', ...eph });
  assert.deepEqual(ok.calls.map((c) => c.type), ['deferUpdate', 'editReply']);
  assert.match(ok.last('editReply').content, /> https:\/\/tenor\.com\/x/);
  assert.ok(ids(ok.last('editReply')).includes(ID.mediaRemove));
});

test('média par fichier: copié localement; le remplacer supprime l\'ancien fichier', async () => {
  db.setBirthdayDate('m3', 'U', 6, 11, null);
  const fetchMock = mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('gif').buffer }));
  const file = { url: 'https://cdn.example/x.gif', contentType: 'image/gif', size: 3 };

  const f1 = await modal(ID.modalMediaFile, {}, { guildId: 'm3', ...eph, files: [file] });
  const first = db.getBirthday('m3', 'U').media_path;
  assert.ok(existsSync(path.join(db.MEDIA_DIR, first)));
  assert.equal(f1.last('editReply').files.length, 1);

  await modal(ID.modalMediaLink, { url: 'https://tenor.com/y' }, { guildId: 'm3', ...eph });
  assert.ok(!existsSync(path.join(db.MEDIA_DIR, first)));
  assert.equal(db.getBirthday('m3', 'U').media_path, null);
  fetchMock.mock.restore();
});

test('média par fichier: type non supporté ou trop lourd refusé sans rien changer', async () => {
  db.setBirthdayDate('m4', 'U', 6, 11, null);
  const pdf = await modal(ID.modalMediaFile, {}, { guildId: 'm4', ...eph, files: [{ url: 'u', contentType: 'application/pdf', size: 1 }] });
  assert.match(pdf.last('followUp').content, /Format non supporté/);
  const big = await modal(ID.modalMediaFile, {}, { guildId: 'm4', ...eph, files: [{ url: 'u', contentType: 'video/mp4', size: 50 * 1024 * 1024 }] });
  assert.match(big.last('followUp').content, /trop lourd/);
  assert.equal(db.getBirthday('m4', 'U').media_path, null);
});

// ── GIF via messages privés ──

const dmMessage = ({ userId = 'U', content = '', stickers = [], attachments = [] } = {}) => {
  const replies = [];
  return {
    replies,
    guild: null,
    author: { id: userId, bot: false },
    content,
    attachments: new Collection(attachments.map((a, n) => [String(n), a])),
    stickers: new Collection(stickers.map((s, n) => [String(n), s])),
    reply: async (x) => { replies.push(x); },
  };
};

test('GIF: ouvre un MP, puis le GIF envoyé est enregistré et le tableau de bord se met à jour', async () => {
  db.setBirthdayDate('g1', 'U', 6, 11, null);
  const sentDm = [];
  const start = await button(ID.mediaGif, { guildId: 'g1', ...eph, dm: { id: 'dm42', send: async (x) => { sentDm.push(x); } } });
  assert.match(sentDm[0], /bouton \*\*GIF\*\*/);
  assert.match(start.last('update').components[0].components[0].data.url, /channels\/@me\/dm42/);

  const nothing = dmMessage({ content: 'salut' });
  await handleDirectMessage(nothing);
  assert.match(nothing.replies[0], /pas trouvé de GIF/);
  assert.equal(db.getBirthday('g1', 'U').media_url, null);

  const gif = dmMessage({ content: 'https://tenor.com/view/party-gif-123' });
  await handleDirectMessage(gif);
  assert.equal(db.getBirthday('g1', 'U').media_url, 'https://tenor.com/view/party-gif-123');
  assert.match(gif.replies[0], /enregistré/);
  assert.match(start.last('editReply').content, /> https:\/\/tenor\.com\/view\/party-gif-123/); // message du serveur mis à jour

  const again = dmMessage({ content: 'https://tenor.com/view/other-1' }); // session terminée: ignoré
  await handleDirectMessage(again);
  assert.equal(again.replies.length, 0);
});

test('GIF: sticker image accepté, sticker animé (Lottie) refusé, MP fermés expliqués', async () => {
  db.setBirthdayDate('g2', 'U', 6, 11, null);
  await button(ID.mediaGif, { guildId: 'g2', ...eph, dm: { id: 'd', send: async () => {} } });

  const lottie = dmMessage({ stickers: [{ format: 3, url: 'x.json' }] });
  await handleDirectMessage(lottie);
  assert.match(lottie.replies[0], /pas supporté/);

  await handleDirectMessage(dmMessage({ stickers: [{ format: 1, url: 'https://media.discordapp.net/stickers/1.png' }] }));
  assert.equal(db.getBirthday('g2', 'U').media_url, 'https://media.discordapp.net/stickers/1.png');

  const closed = await button(ID.mediaGif, { guildId: 'g2', ...eph, dm: Object.assign(new Error('Cannot send'), { code: 50007 }) });
  assert.match(closed.last('update').content, /messages privés/);
});

test('GIF: message privé sans session ouverte ignoré; bots ignorés', async () => {
  const m = dmMessage({ userId: 'nobody', content: 'https://tenor.com/x' });
  await handleDirectMessage(m);
  await handleDirectMessage({ ...dmMessage(), author: { id: 'U', bot: true } });
  assert.equal(m.replies.length, 0);
});

// ── Suppression, isolation, admin ──

test('suppression: confirmation obligatoire, « Non, garder » ramène au tableau de bord', async () => {
  db.setBirthdayDate('x1', 'U', 6, 11, null);
  const ask = await button(ID.del, { guildId: 'x1', ...eph });
  assert.deepEqual(ids(ask.last('update')), [ID.delConfirm, ID.back]);
  assert.ok(db.getBirthday('x1', 'U'));

  const back = await button(ID.back, { guildId: 'x1', ...eph });
  assert.ok(ids(back.last('update')).includes(ID.text));

  await button(ID.delConfirm, { guildId: 'x1', ...eph });
  assert.equal(db.getBirthday('x1', 'U'), undefined);
});

test('les données restent isolées par serveur', async () => {
  await modal(ID.modalDate, { date: '1/5' }, { guildId: 'iso-A' });
  assert.ok(db.getBirthday('iso-A', 'U'));
  assert.equal(db.getBirthday('iso-B', 'U'), undefined);
});

test('prochains anniversaires: liste sans ping', async () => {
  db.setBirthdayDate('x2', 'u1', 6, 11, null);
  const f = await button(ID.upcoming, { guildId: 'x2' });
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
  const f = fakeInteraction({ kind: 'button', customId: ID.dateType });
  f.interaction.showModal = async () => { throw new Error('boom'); };
  const orig = console.error; console.error = () => {};
  await handleInteraction(f.interaction);
  console.error = orig;
  assert.match(f.text(), /Erreur interne/);
});

test('bot non membre du serveur (scope bot manquant): message explicite, aucune erreur', async () => {
  const f = fakeInteraction({ commandName: 'anniversaire-config' });
  f.interaction.guild = null;
  await handleInteraction(f.interaction);
  assert.match(f.text(), /scope \*\*bot\*\*/);
});
