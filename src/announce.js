import { AttachmentBuilder } from 'discord.js';
import { DEFAULT_MESSAGE, ageOn, renderMessage } from './dates.js';
import { mediaFullPath } from './media.js';

export const defaultBirthdayMessage = (birthday, config) => config?.default_message ??
  (birthday.year ? '🎂 Joyeux anniversaire {user} ! {age} ans aujourd’hui ! 🎉' : DEFAULT_MESSAGE);

/**
 * Construit le message d'anniversaire (texte perso > défaut du serveur > défaut global, + média).
 * Les mentions sont limitées à l'utilisateur fêté: un texte perso ne peut pas ping @everyone.
 */
export function buildAnnouncement({ birthday, config, name, year }) {
  const template = birthday.message ?? defaultBirthdayMessage(birthday, config);
  let content = renderMessage(template, {
    userId: birthday.user_id,
    name,
    age: ageOn(birthday, year),
    birthday,
  });
  if (birthday.media_url) content += `\n${birthday.media_url}`;
  content = content.slice(0, 2000); // limite Discord (les variables peuvent gonfler le texte)

  const payload = { content, allowedMentions: { users: [birthday.user_id] } };
  if (birthday.media_path) {
    payload.files = [new AttachmentBuilder(mediaFullPath(birthday.media_path), { name: birthday.media_name })];
  }
  return payload;
}
