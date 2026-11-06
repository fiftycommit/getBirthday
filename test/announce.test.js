import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';

useTempDataDir();
const { buildAnnouncement } = await import('../src/announce.js');
const { DEFAULT_MESSAGE } = await import('../src/dates.js');

const base = { guild_id: 'G', user_id: '42', day: 1, month: 3, year: 2000, message: null, media_path: null, media_url: null };

test('priorité du texte: perso > défaut du serveur > défaut du bot', () => {
  const name = 'Max';
  assert.equal(buildAnnouncement({ birthday: { ...base, message: 'perso' }, config: { default_message: 'srv' }, name, year: 2026 }).content, 'perso');
  assert.equal(buildAnnouncement({ birthday: base, config: { default_message: 'srv' }, name, year: 2026 }).content, 'srv');
  assert.match(buildAnnouncement({ birthday: base, config: null, name, year: 2026 }).content, /26 ans/);
  assert.equal(buildAnnouncement({ birthday: { ...base, year: null }, config: null, name, year: 2026 }).content, DEFAULT_MESSAGE.replace('{user}', '<@42>'));
});

test('seul le membre fêté peut être mentionné (@everyone neutralisé)', () => {
  const p = buildAnnouncement({ birthday: { ...base, message: '@everyone @here {user}' }, config: null, name: 'x', year: 2026 });
  assert.deepEqual(p.allowedMentions, { users: ['42'] });
});

test('âge calculé, lien média ajouté sur sa propre ligne, fichier joint', () => {
  const p = buildAnnouncement({
    birthday: { ...base, message: '{age} ans', media_url: 'https://tenor.com/x', media_path: 'f.mp4', media_name: 'anniversaire.mp4' },
    config: null, name: 'x', year: 2026,
  });
  assert.equal(p.content, '26 ans\nhttps://tenor.com/x');
  assert.equal(p.files.length, 1);
});
