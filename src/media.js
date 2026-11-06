import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR } from './db.js';

// Limite d'upload d'un bot sur un serveur sans boost.
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

/**
 * Les URLs de pièces jointes Discord expirent: on copie le fichier localement
 * pour pouvoir le renvoyer des mois plus tard.
 * @returns {Promise<{path: string, name: string}>}
 */
export async function saveAttachment(guildId, userId, attachment) {
  const ext = EXT_BY_TYPE[attachment.contentType?.split(';')[0]];
  if (!ext) throw new Error('Format non supporté (image, gif ou vidéo: png, jpg, gif, webp, mp4, webm, mov).');
  if (attachment.size > MAX_MEDIA_BYTES) throw new Error('Fichier trop lourd (10 Mo maximum).');

  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA_BYTES) throw new Error('Fichier trop lourd (10 Mo maximum).');

  const file = `${guildId}_${userId}_${Date.now()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, file), buf);
  return { path: file, name: `anniversaire.${ext}` };
}

export const mediaFullPath = (file) => path.join(MEDIA_DIR, file);

export async function removeMediaFile(file) {
  if (file) await rm(mediaFullPath(file), { force: true });
}

/** Accepte uniquement http(s); le lien est posté tel quel pour que Discord le déplie (Tenor, Giphy, YouTube…). */
export function parseMediaUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}

/**
 * URL d'image directe pour l'aperçu du tableau de bord (les messages « Components V2 » ne déplient pas
 * les liens). Page Giphy → son GIF; lien d'image direct → lui-même; autre lien (YouTube…) → null.
 */
export function previewUrlFor(url) {
  if (!url) return null;
  const giphy = url.match(/^https:\/\/giphy\.com\/gifs\/(?:[^/?#]*-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
  if (giphy) return `https://media.giphy.com/media/${giphy[1]}/giphy.gif`;
  return /^https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?\S*)?$/i.test(url) ? url : null;
}
