import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Collection } from 'discord.js';
import { fakeInteraction, useTempDataDir, view } from './helpers.js';

useTempDataDir();
process.env.KLIPY_API_KEY = 'test-key';
delete process.env.GIPHY_API_KEY;
const db = await import('../src/db.js');
const { handleInteraction } = await import('../src/commands.js');
const { ID, handleDirectMessage } = await import('../src/panel.js');

const run = async (args) => {
  const f = fakeInteraction(args);
  await handleInteraction(f.interaction);
  return f;
};
const button = (customId, extra = {}) => run({ kind: 'button', customId, ...extra });
const modal = (customId, fields, extra = {}) => run({ kind: 'modal', customId, fields, ...extra });
const ids = (payload) => view(payload).ids;
const eph = { fromEphemeral: true };

// ── Date ──

test('nouveau membre: le bouton du panneau ouvre la saisie de date, rien n\'est créé', async () => {
  const f = await button(ID.open, { guildId: 'd1' });
  assert.equal(f.last('showModal').data.custom_id, ID.modalDate);
  assert.equal(db.getBirthday('d1', 'U'), undefined);
});

test('date saisie librement (formats variés) → enregistrée, nouveau message privé avec aperçu et actions', async () => {
  const f = await modal(ID.modalDate, { date: '6 novembre 2000' }, { guildId: 'd2' });
  assert.deepEqual(f.calls.map((c) => c.type), ['reply']);
  assert.match(view(f.last('reply')).content, /6 novembre 2000/);
  assert.match(view(f.last('reply')).content, /> 🎂 Joyeux anniversaire <@U>/);
  assert.ok(ids(f.last('reply')).includes(ID.finish));
  await modal(ID.modalDate, { date: '29/02' }, { guildId: 'd3' });
  assert.equal(db.getBirthday('d3', 'U').year, null);
});

test('date invalide ou illisible: refus clair, bouton Réessayer, rien d\'enregistré', async () => {
  for (const date of ['31/02', 'blabla', '29/02/2001']) {
    const f = await modal(ID.modalDate, { date }, { guildId: 'd4' });
    assert.match(view(f.last('reply')).content, /❌/);
    assert.deepEqual(ids(f.last('reply')), [ID.date]);
  }
  assert.equal(db.getBirthday('d4', 'U'), undefined);
});

test('« Changer la date »: fenêtre préremplie; l\'envoi met à jour le tableau de bord sur place', async () => {
  db.setBirthdayDate('d5', 'U', 2, 5, 1999);
  const open = await button(ID.date, { guildId: 'd5', ...eph });
  assert.equal(open.last('showModal').toJSON().components[0].component.value, '02/05/1999');
  const f = await modal(ID.modalDate, { date: '7/3' }, { guildId: 'd5', ...eph });
  assert.deepEqual(f.calls.map((c) => c.type), ['update']);
  assert.equal(db.getBirthday('d5', 'U').month, 3);
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
  assert.match(view(f.last('update')).content, /Joyeux anniversaire/);

  await modal(ID.modalText, { text: open.last('showModal').toJSON().components[0].component.value }, { guildId: 't1', ...eph });
  assert.equal(db.getBirthday('t1', 'U').message, null);
});

test('enregistrer et fermer garde la date et ferme le message privé', async () => {
  db.setBirthdayDate('finish', 'U', 6, 11, 2000);
  const result = await button(ID.finish, { guildId: 'finish', ...eph });
  assert.deepEqual(result.calls.map((call) => call.type), ['deferUpdate', 'deleteReply']);
  assert.equal(db.getBirthday('finish', 'U').year, 2000);
});

test('aperçu: l\'âge est celui de la prochaine occurrence, variables rendues', async () => {
  const year = new Date().getFullYear();
  db.setBirthdayDate('t2', 'U', 1, 1, year - 20);
  db.setBirthdayMessage('t2', 'U', '{nom} aura {age} ans');
  const f = await button(ID.open, { guildId: 't2' });
  const now = new Date();
  const expected = now.getMonth() === 0 && now.getDate() === 1 ? 20 : 21;
  assert.match(view(f.last('reply')).content, new RegExp(`> User aura ${expected} ans`));
});

// ── Aperçu V2 ──

test('tableau de bord en Components V2: aperçu animé du GIF Giphy, du fichier joint, rien pour un lien opaque', async () => {
  db.setBirthdayDate('v1', 'U', 6, 11, null);
  const open = async () => (await button(ID.open, { guildId: 'v1' })).last('reply');

  const plain = await open();
  assert.equal(plain.flags, 32768 | 64); // V2 + éphémère
  assert.deepEqual(view(plain).media, []);

  db.setBirthdayMedia('v1', 'U', { path: null, name: null, url: 'https://giphy.com/gifs/party-time-AbC123' });
  assert.deepEqual(view(await open()).media, ['https://media.giphy.com/media/AbC123/giphy.gif']);

  db.setBirthdayMedia('v1', 'U', { path: null, name: null, url: 'https://www.youtube.com/watch?v=x' });
  assert.deepEqual(view(await open()).media, []);
  assert.match(view(await open()).content, /youtube\.com/); // le lien reste visible dans l'aperçu du message

  writeFileSync(path.join(db.MEDIA_DIR, 'v1.gif'), 'gif');
  db.setBirthdayMedia('v1', 'U', { path: 'v1.gif', name: 'anniversaire.gif', url: null });
  const withFile = await open();
  assert.deepEqual(view(withFile).media, ['attachment://anniversaire.gif']);
  assert.equal(withFile.files.length, 1);
});

// ── Média ──

test('média: le menu propose GIF, appareil, lien; chaque choix ouvre la bonne fenêtre', async () => {
  db.setBirthdayDate('m1', 'U', 6, 11, null);
  const menu = await button(ID.media, { guildId: 'm1', ...eph });
  assert.deepEqual(ids(menu.last('update')), [ID.gifSearch, ID.mediaGif, ID.mediaFile, ID.mediaLink, ID.back]);
  assert.equal((await button(ID.mediaFile, { guildId: 'm1', ...eph })).last('showModal').data.custom_id, ID.modalMediaFile);
  assert.equal((await button(ID.mediaLink, { guildId: 'm1', ...eph })).last('showModal').data.custom_id, ID.modalMediaLink);
});

test('média par lien: http(s) uniquement, affiché dans l\'aperçu', async () => {
  db.setBirthdayDate('m2', 'U', 6, 11, null);
  const bad = await modal(ID.modalMediaLink, { url: 'javascript:alert(1)' }, { guildId: 'm2', ...eph });
  assert.match(view(bad.last('editReply')).content, /invalide/);
  assert.ok(ids(bad.last('editReply')).includes(ID.mediaBack));
  assert.equal(db.getBirthday('m2', 'U').media_url, null);

  const ok = await modal(ID.modalMediaLink, { url: 'https://tenor.com/x' }, { guildId: 'm2', ...eph });
  assert.deepEqual(ok.calls.map((c) => c.type), ['deferUpdate', 'editReply']);
  assert.match(view(ok.last('editReply')).content, /> https:\/\/tenor\.com\/x/);
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
  assert.match(view(pdf.last('editReply')).content, /Format non supporté/);
  const big = await modal(ID.modalMediaFile, {}, { guildId: 'm4', ...eph, files: [{ url: 'u', contentType: 'video/mp4', size: 50 * 1024 * 1024 }] });
  assert.match(view(big.last('editReply')).content, /trop lourd/);
  assert.equal(db.getBirthday('m4', 'U').media_path, null);
});

// ── GIF: recherche KLIPY ──

const gifJson = (n) => ({ ok: true, status: 200, json: async () => ({ result: true, data: { data: Array.from({ length: n }, (_, k) => ({
  id: k, slug: `g${k}`, title: `t${k}`, file: { hd: { gif: { url: `https://static.klipy.com/g${k}/full.gif` } }, xs: { gif: { url: `https://static.klipy.com/g${k}/small.gif` } } },
})) } }) });
const withFetch = async (impl, fn) => {
  const m = mock.method(globalThis, 'fetch', impl);
  try { return await fn(m); } finally { m.mock.restore(); }
};

test('GIF: le menu média propose la recherche seulement si la clé KLIPY est configurée', async () => {
  db.setBirthdayDate('s0', 'U', 6, 11, null);
  assert.ok(ids((await button(ID.media, { guildId: 's0', ...eph })).last('update')).includes(ID.gifSearch));
  delete process.env.KLIPY_API_KEY;
  assert.ok(!ids((await button(ID.media, { guildId: 's0', ...eph })).last('update')).includes(ID.gifSearch));
  process.env.KLIPY_API_KEY = 'test-key';
});

test('GIF: l\'écran s\'ouvre sur les GIF recommandés (grille de 4), pages en boucle, choix par numéro', async () => {
  db.setBirthdayDate('s1', 'U', 6, 11, null);
  const g = { guildId: 's1', ...eph };
  await withFetch(async () => gifJson(8), async (fetchMock) => {
    const open = await button(ID.gifSearch, g);
    assert.deepEqual(open.calls.map((c) => c.type), ['deferUpdate', 'editReply']);
    const first = open.last('editReply');
    assert.deepEqual(view(first).media, [0, 1, 2, 3].map((k) => `https://static.klipy.com/g${k}/small.gif`));
    assert.match(view(first).content, /Powered by KLIPY/);
    assert.equal(first.flags & 32768, 32768); // Components V2
    assert.ok(ids(first).includes(ID.mediaBack));
    const url = new URL(fetchMock.mock.calls[0].arguments[0]);
    assert.equal(url.origin + url.pathname, 'https://api.klipy.com/api/v1/test-key/gifs/trending');
    assert.equal(url.searchParams.get('customer_id'), 'U');
    assert.equal(url.searchParams.get('per_page'), '24');
    assert.equal(url.searchParams.get('format_filter'), 'gif');
    assert.equal(url.searchParams.get('content_filter'), 'high');
    assert.equal(url.searchParams.get('locale'), 'fr');

    assert.equal(view((await button(ID.gifNext, g)).last('update')).media[0], 'https://static.klipy.com/g4/small.gif');
    assert.equal(view((await button(ID.gifNext, g)).last('update')).media[0], 'https://static.klipy.com/g0/small.gif');
    await button(ID.gifPrev, g); // page 2

    const pick = await button(ID.gifPick[1], g); // 2e GIF de la page 2 → g5
    assert.equal(db.getBirthday('s1', 'U').media_url, 'https://static.klipy.com/g5/full.gif');
    assert.deepEqual(view(pick.last('update')).media, ['https://static.klipy.com/g5/full.gif']);
    assert.match(view(pick.last('update')).content, /> https:\/\/static\.klipy\.com\/g5\/full\.gif/);

    await button(ID.gifSearch, g); // tendances servies par le cache: pas de nouvel appel
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});

test('GIF: la recherche remplace les recommandés (mot normalisé, mis en cache)', async () => {
  db.setBirthdayDate('s4', 'U', 6, 11, null);
  const g = { guildId: 's4', ...eph };
  await withFetch(async () => gifJson(5), async (fetchMock) => {
    assert.equal((await button(ID.gifQuery, g)).last('showModal').data.custom_id, ID.modalGif);
    const found = await modal(ID.modalGif, { query: 'Fête  Surprise' }, g);
    assert.match(view(found.last('editReply')).content, /« (fête surprise|Fête  Surprise) »/);
    assert.equal(view(found.last('editReply')).media.length, 4);
    assert.match(fetchMock.mock.calls[0].arguments[0], /gifs\/search\?.*q=f%C3%AAte\+surprise/);

    const lastPage = await button(ID.gifNext, g); // 5 résultats → page 2 n'a qu'un GIF
    assert.equal(view(lastPage.last('update')).media.length, 1);
    assert.deepEqual(ids(lastPage.last('update')).slice(0, 3), [ID.gifQuery, ID.gifCategory, ID.gifPick[0]]);

    await modal(ID.modalGif, { query: 'fête surprise' }, g);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});

test('GIF: les catégories (tuiles façon Discord) lancent la bonne recherche, « À la une » revient aux tendances', async () => {
  db.setBirthdayDate('s5', 'U', 6, 11, null);
  const g = { guildId: 's5', ...eph };
  await withFetch(async () => gifJson(6), async (fetchMock) => {
    await button(ID.gifSearch, g);
    const cat = await run({ kind: 'select', customId: ID.gifCategory, values: ['joyeux anniversaire'], ...g });
    assert.match(view(cat.last('editReply')).content, /« joyeux anniversaire »/);
    assert.match(fetchMock.mock.calls.at(-1).arguments[0], /gifs\/search\?.*q=joyeux\+anniversaire/);
    const top = await run({ kind: 'select', customId: ID.gifCategory, values: ['trending'], ...g });
  });
});

test('GIF: aucun résultat, quota dépassé, KLIPY injoignable → messages clairs, rien d\'enregistré', async () => {
  db.setBirthdayDate('s2', 'U', 6, 11, null);
  const g = { guildId: 's2', ...eph };
  const none = await withFetch(async () => gifJson(0), () => modal(ID.modalGif, { query: 'zzzaucun' }, g));
  assert.match(view(none.last('editReply')).content, /Aucun GIF/);
  const quota = await withFetch(async () => ({ ok: false, status: 429 }), () => modal(ID.modalGif, { query: 'quota' }, g));
  assert.match(view(quota.last('editReply')).content, /Trop de recherches/);
  const down = await withFetch(async () => { throw new Error('network'); }, () => modal(ID.modalGif, { query: 'panne' }, g));
  assert.match(view(down.last('editReply')).content, /ne répond pas/);
  assert.equal(db.getBirthday('s2', 'U').media_url, null);
});

test('GIF: réponse KLIPY invalide signalée sans enregistrer de média', async () => {
  db.setBirthdayDate('s-invalid', 'U', 6, 11, null);
  const g = { guildId: 's-invalid', ...eph };
  for (const [query, body] of [
    ['malforme', { result: true, data: {} }],
    ['echec', { result: false, data: { data: [] } }],
    ['sansmedia', { result: true, data: { data: [{ id: 1, file: {} }] } }],
  ]) {
    const response = await withFetch(async () => ({ ok: true, status: 200, json: async () => body }),
      () => modal(ID.modalGif, { query }, g));
    assert.match(view(response.last('editReply')).content, /réponse invalide/);
  }
  assert.equal(db.getBirthday('s-invalid', 'U').media_url, null);
});

test('GIF: choisir sans recherche active (expirée / redémarrage) → écran « expirée »', async () => {
  db.setBirthdayDate('s3', 'U', 6, 11, null);
  const f = await button(ID.gifPick[0], { guildId: 's3', ...eph });
  assert.match(view(f.last('update')).content, /expiré/);
  assert.equal(db.getBirthday('s3', 'U').media_url, null);
});

const giphyJson = (n) => ({ ok: true, status: 200, json: async () => ({
  meta: { status: 200 }, data: Array.from({ length: n }, (_, k) => ({
    id: `g${k}`, title: `t${k}`, images: {
      original: { url: `https://media.giphy.com/media/g${k}/giphy.gif` },
      fixed_width_small: { url: `https://media.giphy.com/media/g${k}/preview.gif` },
    },
  })),
}) });

test('GIF: les fournisseurs configurés sont proposés indépendamment', async () => {
  db.setBirthdayDate('providers-menu', 'U', 6, 11, null);
  const g = { guildId: 'providers-menu', ...eph };
  process.env.GIPHY_API_KEY = 'giphy-key';
  try {
    let menu = ids((await button(ID.media, g)).last('update'));
    assert.ok(menu.includes(ID.gifSearch) && menu.includes(ID.giphySearch));
    delete process.env.KLIPY_API_KEY;
    menu = ids((await button(ID.media, g)).last('update'));
    assert.ok(!menu.includes(ID.gifSearch) && menu.includes(ID.giphySearch));
    delete process.env.GIPHY_API_KEY;
    menu = ids((await button(ID.media, g)).last('update'));
    assert.ok(!menu.includes(ID.gifSearch) && !menu.includes(ID.giphySearch));
    assert.ok(menu.includes(ID.mediaGif));
  } finally {
    process.env.KLIPY_API_KEY = 'test-key';
    delete process.env.GIPHY_API_KEY;
  }
});

test('GIF: GIPHY et KLIPY conservent chacun recherche et page lors du changement', async () => {
  db.setBirthdayDate('providers-state', 'U', 6, 11, null);
  const g = { guildId: 'providers-state', ...eph };
  process.env.GIPHY_API_KEY = 'giphy-key';
  try {
    await withFetch(async (url) => String(url).includes('api.giphy.com') ? giphyJson(8) : gifJson(8), async (fetchMock) => {
      const first = await button(ID.giphySearch, g);
      assert.match(view(first.last('editReply')).content, /Powered by GIPHY/);
      const url = new URL(fetchMock.mock.calls[0].arguments[0]);
      assert.equal(url.origin + url.pathname, 'https://api.giphy.com/v1/gifs/trending');
      assert.equal(url.searchParams.get('api_key'), 'giphy-key');
      assert.equal(url.searchParams.get('rating'), 'g');
      assert.equal(view(first.last('editReply')).media[0], 'https://media.giphy.com/media/g0/preview.gif');
      await button(ID.giphyNext, g);
      const klipy = await button(ID.gifSearch, g);
      assert.match(view(klipy.last('editReply')).content, /Powered by KLIPY/);
      await modal(ID.modalGif, { query: 'fête' }, g);
      const restored = await button(ID.giphySearch, g);
      assert.equal(view(restored.last('update')).media[0], 'https://media.giphy.com/media/g4/preview.gif');
      const back = await button(ID.gifSearch, g);
      assert.match(view(back.last('update')).content, /« fête »/);
      const search = await modal(ID.modalGiphy, { query: 'Happy  Birthday' }, g);
      assert.match(view(search.last('editReply')).content, /Powered by GIPHY/);
      const searchUrl = new URL(fetchMock.mock.calls.at(-1).arguments[0]);
      assert.equal(searchUrl.pathname, '/v1/gifs/search');
      assert.equal(searchUrl.searchParams.get('q'), 'happy birthday');
      await button(ID.giphyPick[1], g);
      assert.equal(db.getBirthday('providers-state', 'U').media_url, 'https://media.giphy.com/media/g1/giphy.gif');
    });
  } finally {
    delete process.env.GIPHY_API_KEY;
  }
});

test('GIF: erreurs GIPHY sans bascule ni modification du média enregistré', async () => {
  db.setBirthdayDate('giphy-errors', 'U', 6, 11, null);
  db.setBirthdayMedia('giphy-errors', 'U', { path: null, name: null, url: 'https://example.com/old.gif' });
  const g = { guildId: 'giphy-errors', ...eph };
  process.env.GIPHY_API_KEY = 'giphy-key';
  try {
    for (const [query, response, message] of [
      ['aucun-giphy', giphyJson(0), /Aucun GIF GIPHY/],
      ['quota-giphy', { ok: false, status: 429 }, /Trop de recherches GIPHY/],
      ['invalide-giphy', { ok: true, status: 200, json: async () => ({ data: [{}] }) }, /réponse invalide/],
    ]) {
      await withFetch(async () => response, async (fetchMock) => {
        const result = await modal(ID.modalGiphy, { query }, g);
        assert.match(view(result.last('editReply')).content, message);
        assert.equal(fetchMock.mock.callCount(), 1);
        assert.match(fetchMock.mock.calls[0].arguments[0], /api\.giphy\.com/);
      });
    }
    assert.equal(db.getBirthday('giphy-errors', 'U').media_url, 'https://example.com/old.gif');
  } finally {
    delete process.env.GIPHY_API_KEY;
  }
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
  assert.match(view(start.last('update')).links[0], /channels\/@me\/dm42/);

  const nothing = dmMessage({ content: 'salut' });
  await handleDirectMessage(nothing);
  assert.match(nothing.replies[0], /pas trouvé de GIF/);
  assert.equal(db.getBirthday('g1', 'U').media_url, null);

  const gif = dmMessage({ content: 'https://tenor.com/view/party-gif-123' });
  await handleDirectMessage(gif);
  assert.equal(db.getBirthday('g1', 'U').media_url, 'https://tenor.com/view/party-gif-123');
  assert.match(gif.replies[0], /enregistré/);
  assert.match(view(start.last('editReply')).content, /> https:\/\/tenor\.com\/view\/party-gif-123/); // message du serveur mis à jour

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
  assert.match(view(closed.last('update')).content, /messages privés/);
});

test('GIF: message privé sans session ouverte ignoré; bots ignorés', async () => {
  const m = dmMessage({ userId: 'nobody', content: 'https://tenor.com/x' });
  await handleDirectMessage(m);
  await handleDirectMessage({ ...dmMessage(), author: { id: 'U', bot: true } });
  assert.equal(m.replies.length, 0);
});

test('retour depuis la galerie puis le menu média, sans modifier le média enregistré', async () => {
  db.setBirthdayDate('nav', 'U', 6, 11, null);
  db.setBirthdayMedia('nav', 'U', { url: 'https://example.com/original.gif' });
  const menu = await button(ID.mediaBack, { guildId: 'nav', ...eph });
  assert.ok(ids(menu.last('update')).includes(ID.mediaFile));
  const dashboard = await button(ID.back, { guildId: 'nav', ...eph });
  assert.ok(ids(dashboard.last('update')).includes(ID.text));
  assert.equal(db.getBirthday('nav', 'U').media_url, 'https://example.com/original.gif');
});

test('annuler la demande GIF en MP empêche un envoi ultérieur de modifier le média', async () => {
  db.setBirthdayDate('nav-dm', 'U', 6, 11, null);
  await button(ID.mediaGif, { guildId: 'nav-dm', ...eph, dm: { id: 'd', send: async () => {} } });
  await button(ID.back, { guildId: 'nav-dm', ...eph });
  await handleDirectMessage(dmMessage({ content: 'https://tenor.com/view/unwanted' }));
  assert.equal(db.getBirthday('nav-dm', 'U').media_url, null);
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
  assert.match(view(f.last('reply')).content, /<@u1>/);
  assert.deepEqual(f.last('reply').allowedMentions, { parse: [] });
});

test('/anniversaire-panneau: poste le panneau avec ses 2 boutons, refuse si permissions manquantes', async () => {
  const sent = [];
  const mkChannel = (allowed) => ({ permissionsFor: () => ({ has: () => allowed }), send: async (p) => { sent.push(p); } });

  const bad = await run({ commandName: 'anniversaire-panneau', channel: mkChannel(false) });
  assert.match(view(bad.last('reply')).content, /Permissions manquantes/);
  assert.equal(sent.length, 0);

  const ok = await run({ commandName: 'anniversaire-panneau', guildId: 'pan', channel: mkChannel(true) });
  assert.equal(sent.length, 1);
  assert.deepEqual(ids(sent[0]), [ID.open, ID.upcoming]);
  assert.match(view(ok.last('reply')).content, /Panneau posté/);
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

test('bot non membre du serveur (scope bot manquant): message explicite, aucune erreur', async () => {
  const f = fakeInteraction({ commandName: 'anniversaire-config' });
  f.interaction.guild = null;
  await handleInteraction(f.interaction);
  assert.match(f.text(), /scope \*\*bot\*\*/);
});
