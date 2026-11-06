// Interface « zéro commande »: un panneau public avec un bouton, puis un tableau de bord privé
// (message éphémère) qui se met à jour sur place et montre toujours l'aperçu exact de l'annonce.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder,
  LabelBuilder, MessageFlags, ModalBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { buildAnnouncement } from './announce.js';
import {
  DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH, daysUntil, formatDate, nextBirthdayYear, nowIn,
  parseBirthdayInput, validateBirthday,
} from './dates.js';
import {
  deleteBirthday, getBirthday, getGuildConfig, listBirthdays, setBirthdayDate, setBirthdayMedia,
  setBirthdayMessage,
} from './db.js';
import { parseMediaUrl, removeMediaFile, saveAttachment } from './media.js';

export const ID = {
  open: 'bday:open',
  upcoming: 'bday:upcoming',
  date: 'bday:date',
  text: 'bday:text',
  textReset: 'bday:text-reset',
  media: 'bday:media',
  mediaRemove: 'bday:media-remove',
  del: 'bday:delete',
  delConfirm: 'bday:delete-confirm',
  delCancel: 'bday:delete-cancel',
  modalDate: 'bday:m:date',
  modalText: 'bday:m:text',
  modalMedia: 'bday:m:media',
};

const EPHEMERAL = MessageFlags.Ephemeral;
const NO_MENTIONS = { parse: [] };
const DEFAULT_TZ = 'Europe/Paris';
const MAX_URL_LENGTH = 400;

const button = (id, label, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);

// ───────────────────────── Panneau public ─────────────────────────

export function buildPanel() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle('🎂 Ne rate plus aucun anniversaire')
      .setDescription(
        'Ajoute le tien en 30 secondes: ta date, ton message, et même un GIF, une photo ou une vidéo.\n'
        + 'Le jour J, je le poste pour toi 🎉\n\n'
        + '**Clique sur le bouton, je te guide.**',
      )],
    components: [new ActionRowBuilder().addComponents(
      button(ID.open, 'Ajouter mon anniversaire', '🎂', ButtonStyle.Primary),
      button(ID.upcoming, 'Prochains anniversaires', '📅'),
    )],
  };
}

// ───────────────────────── Tableau de bord privé ─────────────────────────

function effectiveDefault(config) {
  return config?.default_message ?? DEFAULT_MESSAGE;
}

/**
 * Message éphémère: en-tête + aperçu fidèle (même fonction que celle qui poste l'annonce) + actions.
 * Les boutons secondaires n'apparaissent que s'ils ont un sens (pas de « retirer » sans média).
 */
export function buildDashboard({ guildId, userId, name, notice = null }) {
  const b = getBirthday(guildId, userId);
  const config = getGuildConfig(guildId);
  const tz = config?.timezone ?? DEFAULT_TZ;
  const today = nowIn(tz);

  const announcement = buildAnnouncement({ birthday: b, config, name, year: nextBirthdayYear(b, today) });
  const quoted = announcement.content.split('\n').map((l) => `> ${l}`).join('\n');
  const where = config?.channel_id
    ? `à ${config.hour}h dans <#${config.channel_id}>`
    : '… dès qu\'un admin aura choisi le salon (`/anniversaire-config`)';

  const content = [
    notice,
    `### 🎂 Ton anniversaire: **${formatDate(b)}**`,
    `-# Aperçu du message posté le jour J ${where}`,
    quoted,
  ].filter(Boolean).join('\n');

  const main = new ActionRowBuilder().addComponents(
    button(ID.text, 'Modifier mon message', '✏️', ButtonStyle.Primary),
    button(ID.media, b.media_path || b.media_url ? 'Changer le média' : 'Ajouter un média', '🖼️', ButtonStyle.Primary),
    button(ID.date, 'Changer la date', '📅'),
  );
  const extra = new ActionRowBuilder();
  if (b.message) extra.addComponents(button(ID.textReset, 'Message par défaut', '↩️'));
  if (b.media_path || b.media_url) extra.addComponents(button(ID.mediaRemove, 'Retirer le média', '🚫'));
  extra.addComponents(button(ID.del, 'Tout supprimer', '🗑️', ButtonStyle.Danger));

  return {
    content,
    files: announcement.files ?? [],
    components: [main, extra],
    allowedMentions: NO_MENTIONS,
  };
}

const confirmDelete = () => ({
  content: '### 🗑️ Tout supprimer ?\nTa date, ton message et ton média seront effacés. Tu ne seras plus fêté·e.',
  files: [],
  components: [new ActionRowBuilder().addComponents(
    button(ID.delConfirm, 'Oui, supprimer', '🗑️', ButtonStyle.Danger),
    button(ID.delCancel, 'Non, garder', '↩️'),
  )],
  allowedMentions: NO_MENTIONS,
});

/** Répond sur place si on clique depuis un message privé, sinon crée un nouveau message privé. */
async function respond(i, payload) {
  const fromDashboard = i.isFromMessage?.() && i.message.flags.has(EPHEMERAL);
  if (fromDashboard) return i.update({ ...payload, attachments: [] });
  return i.reply({ ...payload, flags: EPHEMERAL });
}

/** Variante après un `deferUpdate`/`deferReply` (opérations longues: téléchargement de média). */
const respondDeferred = (i, payload) => i.editReply({ ...payload, attachments: [] });

const nameOf = (i) => i.member?.displayName ?? i.user.displayName ?? i.user.username;
const dash = (i, extra = {}) =>
  buildDashboard({ guildId: i.guildId, userId: i.user.id, name: nameOf(i), ...extra });

// ───────────────────────── Fenêtres de saisie ─────────────────────────

function dateModal(current) {
  return new ModalBuilder().setCustomId(ID.modalDate).setTitle('Ton anniversaire').addLabelComponents(
    new LabelBuilder()
      .setLabel('Ta date de naissance')
      .setDescription('Jour et mois suffisent. L\'année est facultative (elle sert à afficher ton âge).')
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId('date').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)
        .setPlaceholder('ex : 06/11/2000 ou 6 novembre')
        .setValue(current ? `${String(current.day).padStart(2, '0')}/${String(current.month).padStart(2, '0')}${current.year ? `/${current.year}` : ''}` : '')),
  );
}

function textModal(current, config) {
  return new ModalBuilder().setCustomId(ID.modalText).setTitle('Ton message').addLabelComponents(
    new LabelBuilder()
      .setLabel('Message d\'anniversaire')
      .setDescription('{user} = ta mention · {nom} = ton pseudo · {age} = ton âge · {date} = ta date')
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId('text').setStyle(TextInputStyle.Paragraph).setRequired(true)
        .setMaxLength(MAX_MESSAGE_LENGTH)
        .setValue(current.message ?? effectiveDefault(config))),
  );
}

function mediaModal() {
  return new ModalBuilder().setCustomId(ID.modalMedia).setTitle('Ton média').addTextDisplayComponents(
    new TextDisplayBuilder().setContent('Choisis **une image, un GIF ou une vidéo** (10 Mo max) — ou colle un lien. Un seul des deux.'),
  ).addLabelComponents(
    new LabelBuilder()
      .setLabel('Depuis ton appareil')
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('file').setRequired(false).setMinValues(0).setMaxValues(1)),
    new LabelBuilder()
      .setLabel('Ou un lien')
      .setDescription('Tenor, Giphy, YouTube, lien d\'image…')
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId('url').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(MAX_URL_LENGTH)
        .setPlaceholder('https://…')),
  );
}

// ───────────────────────── Liste des prochains anniversaires ─────────────────────────

export function upcomingText(guildId) {
  const today = nowIn(getGuildConfig(guildId)?.timezone ?? DEFAULT_TZ);
  const next = listBirthdays(guildId)
    .map((b) => ({ b, in: daysUntil(b, today) }))
    .sort((a, b) => a.in - b.in)
    .slice(0, 10);
  if (next.length === 0) return 'Aucun anniversaire enregistré pour l\'instant. Sois le premier ! 🎂';
  return next.map(({ b, in: d }) => {
    const when = d === 0 ? '**aujourd\'hui** 🎉' : d === 1 ? 'demain' : `dans ${d} jours`;
    return `• <@${b.user_id}> — ${formatDate({ ...b, year: null })} (${when})`;
  }).join('\n');
}

// ───────────────────────── Routage ─────────────────────────

/** Ouvre le parcours: saisie de la date pour un nouveau, tableau de bord pour un inscrit. */
export async function openFlow(i) {
  const b = getBirthday(i.guildId, i.user.id);
  if (!b) return i.showModal(dateModal(null));
  return i.reply({ ...dash(i), flags: EPHEMERAL });
}

const retryDate = (message) => ({
  content: message,
  components: [new ActionRowBuilder().addComponents(button(ID.date, 'Réessayer', '📅', ButtonStyle.Primary))],
  allowedMentions: NO_MENTIONS,
});

const actions = {
  [ID.open]: openFlow,
  [ID.upcoming]: (i) => i.reply({ content: upcomingText(i.guildId), flags: EPHEMERAL, allowedMentions: NO_MENTIONS }),

  [ID.date]: (i) => i.showModal(dateModal(getBirthday(i.guildId, i.user.id))),
  [ID.text]: (i) => {
    const b = getBirthday(i.guildId, i.user.id);
    return b ? i.showModal(textModal(b, getGuildConfig(i.guildId))) : openFlow(i);
  },
  [ID.media]: (i) => (getBirthday(i.guildId, i.user.id) ? i.showModal(mediaModal()) : openFlow(i)),

  async [ID.textReset](i) {
    setBirthdayMessage(i.guildId, i.user.id, null);
    return respond(i, dash(i, { notice: '↩️ Message par défaut rétabli.' }));
  },
  async [ID.mediaRemove](i) {
    const b = getBirthday(i.guildId, i.user.id);
    setBirthdayMedia(i.guildId, i.user.id, null);
    await removeMediaFile(b?.media_path);
    return respond(i, dash(i, { notice: '🚫 Média retiré.' }));
  },
  [ID.del]: (i) => respond(i, confirmDelete()),
  async [ID.delConfirm](i) {
    const b = getBirthday(i.guildId, i.user.id);
    await removeMediaFile(b?.media_path);
    deleteBirthday(i.guildId, i.user.id);
    return respond(i, { content: '🗑️ C\'est fait, tout est supprimé. Tu peux revenir quand tu veux !', files: [], components: [], allowedMentions: NO_MENTIONS });
  },
  [ID.delCancel]: (i) => respond(i, dash(i)),

  async [ID.modalDate](i) {
    const raw = i.fields.getTextInputValue('date');
    const parsed = parseBirthdayInput(raw);
    const error = parsed
      ? validateBirthday(parsed, new Date().getFullYear())
      : 'Je n\'ai pas compris cette date.';
    if (error) {
      return i.reply({ ...retryDate(`❌ ${error}\nÉcris par exemple **06/11/2000** ou **6 novembre** (l'année est facultative).`), flags: EPHEMERAL });
    }
    const existed = Boolean(getBirthday(i.guildId, i.user.id));
    setBirthdayDate(i.guildId, i.user.id, parsed.day, parsed.month, parsed.year);
    const notice = existed ? null : '✅ C\'est enregistré ! Tu peux maintenant personnaliser ton message ⬇️';
    return respond(i, dash(i, { notice }));
  },

  async [ID.modalText](i) {
    const config = getGuildConfig(i.guildId);
    const text = i.fields.getTextInputValue('text').trim();
    // Texte vide ou identique au défaut: on suit le défaut (il évolue avec la config du serveur).
    setBirthdayMessage(i.guildId, i.user.id, !text || text === effectiveDefault(config) ? null : text);
    return respond(i, dash(i, { notice: '✅ Message enregistré.' }));
  },

  async [ID.modalMedia](i) {
    const file = i.fields.getUploadedFiles('file')?.first() ?? null;
    const rawUrl = i.fields.getTextInputValue('url').trim();
    if (!file === !rawUrl) {
      return i.reply({ content: '❌ Choisis soit un fichier, soit un lien (pas les deux, pas aucun).', flags: EPHEMERAL });
    }
    await i.deferUpdate();

    let media;
    try {
      if (file) {
        const saved = await saveAttachment(i.guildId, i.user.id, file);
        media = { path: saved.path, name: saved.name, url: null };
      } else {
        const url = parseMediaUrl(rawUrl);
        if (!url) throw new Error('Lien invalide (il doit commencer par http:// ou https://).');
        media = { path: null, name: null, url };
      }
    } catch (err) {
      return i.followUp({ content: `❌ ${err.message}`, flags: EPHEMERAL });
    }
    const previous = getBirthday(i.guildId, i.user.id);
    setBirthdayMedia(i.guildId, i.user.id, media);
    await removeMediaFile(previous?.media_path);
    return respondDeferred(i, dash(i, { notice: '✅ Média enregistré.' }));
  },
};

/** Boutons et fenêtres du parcours (customId `bday:*`). Retourne false si l'interaction n'est pas pour nous. */
export async function handlePanelInteraction(i) {
  if (!(i.isButton() || i.isModalSubmit()) || !i.guildId) return false;
  const action = actions[i.customId];
  if (!action) return false;
  await action(i);
  return true;
}
