import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempDataDir } from './helpers.js';

useTempDataDir();
const db = await import('../src/db.js');
const { runBackup, BACKUP_DIR } = await import('../src/backup.js');

test('sauvegarde: base lisible, médias en liens physiques, aucun dossier temporaire', () => {
  db.setBirthdayDate('G', 'U', 1, 3, 2001);
  writeFileSync(path.join(db.MEDIA_DIR, 'a.png'), 'img');

  const dir = runBackup(new Date('2026-01-01T00:00:00Z'));
  const copy = new DatabaseSync(path.join(dir, 'birthdays.db'), { readOnly: true });
  assert.equal(copy.prepare('SELECT count(*) AS n FROM birthdays').get().n, 1);
  copy.close();

  assert.equal(statSync(path.join(dir, 'media/a.png')).nlink, 2);
  assert.ok(!readdirSync(BACKUP_DIR).some((n) => n.startsWith('.tmp')));
});

test('sauvegarde: la suppression d\'un média ne casse pas les anciennes sauvegardes', () => {
  rmSync(path.join(db.MEDIA_DIR, 'a.png'));
  assert.equal(readFileSync(path.join(BACKUP_DIR, '2026-01-01T000000Z/media/a.png'), 'utf8'), 'img');
});

test('rotation: seules les 30 plus récentes sont gardées', () => {
  for (let i = 1; i <= 32; i++) runBackup(new Date(Date.UTC(2026, 1, 1, 0, i)));
  const names = readdirSync(BACKUP_DIR).sort();
  assert.equal(names.length, 30);
  assert.ok(!existsSync(path.join(BACKUP_DIR, '2026-01-01T000000Z')));
  assert.equal(names.at(-1), '2026-02-01T003200Z');
});

