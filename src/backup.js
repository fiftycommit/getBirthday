import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, MEDIA_DIR, snapshotDb } from './db.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 30;
const MAX_AGE_MS = 24 * 3600_000;

const list = () =>
  existsSync(BACKUP_DIR)
    ? readdirSync(BACKUP_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(n)).sort()
    : [];

/**
 * Sauvegarde cohérente: snapshot SQLite + copie des médias, écrite dans un dossier
 * temporaire puis renommée (un backup n'est jamais visible à moitié écrit).
 * Rotation: on garde les KEEP plus récents.
 */
export function runBackup(now = new Date()) {
  const stamp = now.toISOString().replaceAll(':', '').replace(/\.\d+Z$/, 'Z');
  const final = path.join(BACKUP_DIR, stamp);
  const tmp = path.join(BACKUP_DIR, `.tmp-${stamp}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    snapshotDb(path.join(tmp, 'birthdays.db'));
    cpSync(MEDIA_DIR, path.join(tmp, 'media'), { recursive: true });
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  for (const old of list().slice(0, -KEEP)) rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  return final;
}

/** Au démarrage puis chaque heure: sauvegarde si la dernière a plus de 24 h (robuste aux redémarrages). */
export function startBackupSchedule() {
  const check = () => {
    try {
      const newest = list().at(-1);
      const age = newest ? Date.now() - statSync(path.join(BACKUP_DIR, newest)).mtimeMs : Infinity;
      if (age > MAX_AGE_MS) console.log(`Sauvegarde: ${runBackup()}`);
    } catch (err) {
      console.error('Sauvegarde échouée', err);
    }
  };
  check();
  return setInterval(check, 3600_000);
}
