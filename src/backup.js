import {
  copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync, statSync,
} from 'node:fs';
import path from 'node:path';
import { DATA_DIR, MEDIA_DIR, snapshotDb } from './db.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 30;
const MAX_AGE_MS = 24 * 3600_000;

const list = () =>
  existsSync(BACKUP_DIR)
    ? readdirSync(BACKUP_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(n)).sort()
    : [];

// Les médias ne changent jamais en place : les liens physiques évitent de les recopier.
// Si le lien est impossible, on copie le fichier.
function linkMedia(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    try {
      linkSync(path.join(src, name), path.join(dst, name));
    } catch {
      copyFileSync(path.join(src, name), path.join(dst, name));
    }
  }
}

// Le renommage rend la sauvegarde visible seulement une fois complète.
export function runBackup(now = new Date()) {
  const stamp = now.toISOString().replaceAll(':', '').replace(/\.\d+Z$/, 'Z');
  const final = path.join(BACKUP_DIR, stamp);
  const tmp = path.join(BACKUP_DIR, `.tmp-${stamp}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    snapshotDb(path.join(tmp, 'birthdays.db'));
    linkMedia(MEDIA_DIR, path.join(tmp, 'media'));
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  for (const old of list().slice(0, -KEEP)) rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  return final;
}

// Vérifier au démarrage puis chaque heure si une sauvegarde est nécessaire.
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
