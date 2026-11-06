import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR } from './db.js';

// Limite d'upload d'un bot sur un serveur sans boost.
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

// Les liens Discord expirent : on conserve une copie locale de la pièce jointe.
export async function saveAttachment(guildId, userId, attachment) {
  const ext = EXT_BY_TYPE[attachment.contentType?.split(';')[0]];
  if (!ext) throw new Error('Format non supporté (image, gif ou vidéo: png, jpg, gif, webp, mp4, webm, mov).');
  if (attachment.size > MAX_MEDIA_BYTES) throw new Error('Fichier trop lourd (10 Mo maximum).');

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Téléchargement impossible (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('Fichier trop lourd (10 Mo maximum).');

  const file = `${guildId}_${userId}_${Date.now()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, file), buffer);
  return { path: file, name: `anniversaire.${ext}` };
}

export const mediaFullPath = (file) => path.join(MEDIA_DIR, file);

export async function removeMediaFile(file) {
  if (file) await rm(mediaFullPath(file), { force: true });
}

// Discord déplie les liens http(s) dans les messages.
export function parseMediaUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}

// Les composants Discord ne déplient pas les liens : l'aperçu nécessite une URL d'image.
export function previewUrlFor(url) {
  if (!url) return null;
  const giphy = url.match(/^https:\/\/giphy\.com\/gifs\/(?:[^/?#]*-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
  if (giphy) return `https://media.giphy.com/media/${giphy[1]}/giphy.gif`;
  return /^https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?\S*)?$/i.test(url) ? url : null;
}
