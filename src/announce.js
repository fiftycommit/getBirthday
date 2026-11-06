import { AttachmentBuilder } from 'discord.js';
import { DEFAULT_MESSAGE, ageOn, renderMessage } from './dates.js';
import { mediaFullPath } from './media.js';

/**
 * Construit le message d'anniversaire (texte perso > défaut du serveur > défaut global, + média).
 * Les mentions sont limitées à l'utilisateur fêté: un texte perso ne peut pas ping @everyone.
 */
export function buildAnnouncement({ birthday, config, name, year }) {
  const template = birthday.message ?? config?.default_message ?? DEFAULT_MESSAGE;
  let content = renderMessage(template, {
    userId: birthday.user_id,
    name,
    age: ageOn(birthday, year),
    birthday,
  });
  if (birthday.media_url) content += `\n${birthday.media_url}`;

  const payload = { content, allowedMentions: { users: [birthday.user_id] } };
  if (birthday.media_path) {
    payload.files = [new AttachmentBuilder(mediaFullPath(birthday.media_path), { name: birthday.media_name })];
  }
  return payload;
}
