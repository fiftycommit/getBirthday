import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

export const DATA_DIR = new URL('../data/', import.meta.url).pathname;
export const MEDIA_DIR = `${DATA_DIR}media/`;
mkdirSync(MEDIA_DIR, { recursive: true });

const db = new DatabaseSync(`${DATA_DIR}birthdays.db`);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS birthdays (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER,
    message TEXT,
    media_path TEXT,
    media_name TEXT,
    media_url TEXT,
    last_announced_year INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    hour INTEGER NOT NULL DEFAULT 9,
    timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
    default_message TEXT
  );
`);

const q = {
  get: db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  list: db.prepare('SELECT * FROM birthdays WHERE guild_id = ?'),
  // Changer la date réarme l'annonce de l'année en cours.
  upsertDate: db.prepare(`
    INSERT INTO birthdays (guild_id, user_id, day, month, year) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      day = excluded.day, month = excluded.month, year = excluded.year, last_announced_year = NULL`),
  setMessage: db.prepare('UPDATE birthdays SET message = ? WHERE guild_id = ? AND user_id = ?'),
  setMedia: db.prepare(
    'UPDATE birthdays SET media_path = ?, media_name = ?, media_url = ? WHERE guild_id = ? AND user_id = ?',
  ),
  markAnnounced: db.prepare(
    'UPDATE birthdays SET last_announced_year = ? WHERE guild_id = ? AND user_id = ?',
  ),
  remove: db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  getConfig: db.prepare('SELECT * FROM guild_config WHERE guild_id = ?'),
  allConfigs: db.prepare('SELECT * FROM guild_config WHERE channel_id IS NOT NULL'),
  upsertConfig: db.prepare(`
    INSERT INTO guild_config (guild_id, channel_id, hour, timezone, default_message)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guild_id) DO UPDATE SET
      channel_id = excluded.channel_id, hour = excluded.hour, timezone = excluded.timezone,
      default_message = excluded.default_message`),
};

export const getBirthday = (g, u) => q.get.get(g, u);
export const listBirthdays = (g) => q.list.all(g);
export const setBirthdayDate = (g, u, day, month, year) => q.upsertDate.run(g, u, day, month, year);
export const setBirthdayMessage = (g, u, message) => q.setMessage.run(message, g, u);
export const setBirthdayMedia = (g, u, m) =>
  q.setMedia.run(m?.path ?? null, m?.name ?? null, m?.url ?? null, g, u);
export const markAnnounced = (g, u, year) => q.markAnnounced.run(year, g, u);
export const deleteBirthday = (g, u) => q.remove.run(g, u);

export const getGuildConfig = (g) => q.getConfig.get(g);
export const listGuildConfigs = () => q.allConfigs.all();
export function saveGuildConfig(g, patch) {
  const cur = q.getConfig.get(g) ?? {
    channel_id: null, hour: 9, timezone: 'Europe/Paris', default_message: null,
  };
  const next = { ...cur, ...patch };
  q.upsertConfig.run(g, next.channel_id, next.hour, next.timezone, next.default_message);
  return next;
}
