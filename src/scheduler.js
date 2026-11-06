import { buildAnnouncement } from './announce.js';
import { isBirthdayToday, nowIn } from './dates.js';
import { deleteBirthday, listBirthdays, listGuildConfigs, markAnnounced } from './db.js';
import { removeMediaFile } from './media.js';

const TICK_MS = 60_000;
const RETRY_DELAY_MS = 10 * 60_000;
const retryAfter = new Map();

const DISCORD_UNKNOWN_MEMBER = 10007;

async function announceGuild(client, config) {
  const now = nowIn(config.timezone);
  // Rattraper les annonces de la journée après un redémarrage.
  if (now.hour < config.hour) return;

  const due = listBirthdays(config.guild_id).filter(
    (b) => isBirthdayToday(b, now) && b.last_announced_year !== now.year,
  );
  if (due.length === 0) return;

  const guild = client.guilds.cache.get(config.guild_id);
  const channel = guild && (await guild.channels.fetch(config.channel_id).catch(() => null));
  if (!channel?.isTextBased()) {
    console.warn(`[${config.guild_id}] salon d'annonce introuvable ou inaccessible`);
    return;
  }

  for (const b of due) {
    const key = `${b.guild_id}:${b.user_id}`;
    if ((retryAfter.get(key) ?? 0) > Date.now()) continue;

    let member;
    try {
      member = await guild.members.fetch(b.user_id);
    } catch (err) {
      if (err.code === DISCORD_UNKNOWN_MEMBER) {
        // Supprimer les données d'un membre qui a quitté le serveur.
        await removeMediaFile(b.media_path);
        deleteBirthday(b.guild_id, b.user_id);
      } else {
        console.error(`[${key}] fetch membre`, err);
        retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
      }
      continue;
    }

    try {
      await channel.send(buildAnnouncement({ birthday: b, config, name: member.displayName, year: now.year }));
      markAnnounced(b.guild_id, b.user_id, now.year);
      retryAfter.delete(key);
    } catch (err) {
      console.error(`[${key}] envoi`, err);
      retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
    }
  }
}

let running = false;

export async function runTick(client) {
  if (running) return;
  running = true;
  try {
    for (const config of listGuildConfigs()) {
      await announceGuild(client, config).catch((err) => console.error('scheduler', err));
    }
  } finally {
    running = false;
  }
}

export function startScheduler(client) {
  runTick(client);
  return setInterval(() => runTick(client), TICK_MS);
}
