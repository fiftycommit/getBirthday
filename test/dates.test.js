import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, isBirthdayToday, nowIn, renderMessage, validateBirthday } from '../src/dates.js';

test('29 février: invalide hors bissextile, valide sans année', () => {
  assert.ok(validateBirthday({ day: 29, month: 2, year: 2001 }, 2026));
  assert.equal(validateBirthday({ day: 29, month: 2, year: 2000 }, 2026), null);
  assert.equal(validateBirthday({ day: 29, month: 2 }, 2026), null);
  assert.ok(validateBirthday({ day: 31, month: 4 }, 2026));
  assert.ok(validateBirthday({ day: 1, month: 1, year: 2027 }, 2026));
});

test('29 février fêté le 28 hors bissextile, le 29 sinon', () => {
  const b = { day: 29, month: 2, year: 2000 };
  assert.ok(isBirthdayToday(b, { year: 2027, month: 2, day: 28 }));
  assert.ok(!isBirthdayToday(b, { year: 2027, month: 3, day: 1 }));
  assert.ok(isBirthdayToday(b, { year: 2028, month: 2, day: 29 }));
  assert.ok(!isBirthdayToday(b, { year: 2028, month: 2, day: 28 }));
});

test('daysUntil: aujourd\'hui, passage d\'année, 29/02', () => {
  const today = { year: 2026, month: 11, day: 6 };
  assert.equal(daysUntil({ day: 6, month: 11 }, today), 0);
  assert.equal(daysUntil({ day: 7, month: 11 }, today), 1);
  assert.equal(daysUntil({ day: 5, month: 11 }, today), 364);
  assert.equal(daysUntil({ day: 1, month: 1 }, today), 56);
  assert.equal(daysUntil({ day: 29, month: 2 }, today), 114); // 28/02/2027
  assert.equal(daysUntil({ day: 29, month: 2 }, { year: 2027, month: 12, day: 31 }), 60); // 29/02/2028
});

test('nowIn respecte le fuseau', () => {
  const d = new Date('2026-12-31T23:30:00Z');
  assert.deepEqual(nowIn('Europe/Paris', d), { year: 2027, month: 1, day: 1, hour: 0 });
  assert.deepEqual(nowIn('America/New_York', d), { year: 2026, month: 12, day: 31, hour: 18 });
});

test('renderMessage: substitution unique, pas de ré-interprétation', () => {
  const out = renderMessage('{user} {nom} {age} {date}', {
    userId: '42', name: '{age}', age: null, birthday: { day: 1, month: 3 },
  });
  assert.equal(out, '<@42> {age} ? 1 mars');
});

test('parseBirthdayInput: formats courants, mois en lettres, illisible → null', async () => {
  const { parseBirthdayInput, nextBirthdayYear } = await import('../src/dates.js');
  const cases = {
    '06/11/2000': { day: 6, month: 11, year: 2000 },
    '6-11': { day: 6, month: 11, year: null },
    '6.11.2000': { day: 6, month: 11, year: 2000 },
    '2000-11-06': { day: 6, month: 11, year: 2000 },
    '6 novembre 2000': { day: 6, month: 11, year: 2000 },
    '1er mars': { day: 1, month: 3, year: null },
    '12 Décembre': { day: 12, month: 12, year: null },
    '6 sept.': { day: 6, month: 9, year: null },
  };
  for (const [input, expected] of Object.entries(cases)) assert.deepEqual(parseBirthdayInput(input), expected, input);
  for (const bad of ['', 'blabla', '6', '6/11/20', '6 xyz']) assert.equal(parseBirthdayInput(bad), null, bad);

  const today = { year: 2026, month: 11, day: 6 };
  assert.equal(nextBirthdayYear({ day: 6, month: 11 }, today), 2026);
  assert.equal(nextBirthdayYear({ day: 5, month: 11 }, today), 2027);
  assert.equal(nextBirthdayYear({ day: 29, month: 2 }, today), 2027);
});
