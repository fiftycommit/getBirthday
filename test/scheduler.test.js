import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';

useTempDataDir();
const db = await import('../src/db.js');
const { runTick } = await import('../src/scheduler.js');

function fakeClient(guildId, { memberError = null, sendError = null } = {}) {
  const sent = [];
  const client = {
    guilds: { cache: new Map([[guildId, {
      channels: { fetch: async () => ({
        isTextBased: () => true,
        send: async (p) => { if (sendError?.()) throw new Error('send'); sent.push(p); },
      }) },
      members: { fetch: async () => { if (memberError) throw memberError; return { displayName: 'Max' }; } },
    }]]) },
  };
  return { client, sent };
}
const at = (iso) => mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
const setup = (guild, user, day, month, hour = 9) => {
  db.saveGuildConfig(guild, { channel_id: 'C', hour, timezone: 'Europe/Paris' });
  db.setBirthdayDate(guild, user, day, month, 2000);
};

test('annonce à partir de l\'heure configurée, une seule fois par an', async () => {
  setup('g1', 'u1', 6, 11);
  const { client, sent } = fakeClient('g1');

  at('2026-11-06T07:00:00+01:00'); // 7h < 9h
  await runTick(client);
  assert.equal(sent.length, 0);

  mock.timers.setTime(new Date('2026-11-06T09:00:00+01:00').getTime());
  await runTick(client);
  await runTick(client);
  assert.equal(sent.length, 1);

  mock.timers.setTime(new Date('2027-11-06T09:00:00+01:00').getTime()); // année suivante: de nouveau annoncé
  await runTick(client);
  assert.equal(sent.length, 2);
  mock.timers.reset();
});

test('le fuseau horaire décide du jour (23h30 UTC = lendemain à Paris)', async () => {
  setup('g2', 'u1', 1, 1, 0);
  const { client, sent } = fakeClient('g2');
  at('2026-12-31T23:30:00Z');
  await runTick(client);
  assert.equal(sent.length, 1);
  mock.timers.reset();
});

test('29 février: fêté le 28 hors bissextile, pas le 28 en bissextile', async () => {
  setup('g3', 'u1', 29, 2, 0);
  const { client, sent } = fakeClient('g3');
  at('2028-02-28T12:00:00+01:00');
  await runTick(client);
  assert.equal(sent.length, 0);
  mock.timers.setTime(new Date('2028-02-29T12:00:00+01:00').getTime());
  await runTick(client);
  assert.equal(sent.length, 1);
  mock.timers.setTime(new Date('2029-02-28T12:00:00+01:00').getTime());
  await runTick(client);
  assert.equal(sent.length, 2);
  mock.timers.reset();
});

test('membre parti du serveur: données purgées, rien envoyé', async () => {
  setup('g4', 'gone', 6, 11, 0);
  const { client, sent } = fakeClient('g4', { memberError: Object.assign(new Error('Unknown Member'), { code: 10007 }) });
  at('2026-11-06T12:00:00+01:00');
  await runTick(client);
  assert.equal(sent.length, 0);
  assert.equal(db.getBirthday('g4', 'gone'), undefined);
  mock.timers.reset();
});

test('échec d\'envoi: non marqué, nouvelle tentative après 10 min seulement', async () => {
  setup('g5', 'u1', 6, 11, 0);
  let fail = true;
  const { client, sent } = fakeClient('g5', { sendError: () => fail });
  const log = mock.method(console, 'error', () => {});
  at('2026-11-06T12:00:00+01:00');
  await runTick(client);
  assert.equal(db.getBirthday('g5', 'u1').last_announced_year, null);

  fail = false;
  mock.timers.setTime(new Date('2026-11-06T12:05:00+01:00').getTime());
  await runTick(client);
  assert.equal(sent.length, 0); // encore en attente

  mock.timers.setTime(new Date('2026-11-06T12:11:00+01:00').getTime());
  await runTick(client);
  assert.equal(sent.length, 1);
  assert.equal(db.getBirthday('g5', 'u1').last_announced_year, 2026);
  log.mock.restore();
  mock.timers.reset();
});
