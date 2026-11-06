// Interface « zéro commande »: un panneau public avec un bouton, puis un tableau de bord privé
// (message éphémère) qui se met à jour sur place et montre toujours l'aperçu exact de l'annonce.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, StickerFormatType, StringSelectMenuBuilder, TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buildAnnouncement } from './announce.js';
import {
  DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH, MONTH_NAMES, daysUntil, formatDate, nextBirthdayYear, nowIn,
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
  back: 'bday:back',
  // date
  date: 'bday:date',
  dateType: 'bday:date-type',
  pickMonth: 'bday:pick-month',
  pickDayA: 'bday:pick-day-a',
  pickDayB: 'bday:pick-day-b',
  pickYear: 'bday:pick-year',
  pickOk: 'bday:pick-ok',
  modalDate: 'bday:m:date',
  modalYear: 'bday:m:year',
  // texte
  text: 'bday:text',
  textReset: 'bday:text-reset',
  modalText: 'bday:m:text',
  // média
  media: 'bday:media',
  mediaGif: 'bday:media-gif',
  mediaFile: 'bday:media-file',
  mediaLink: 'bday:media-link',
  mediaRemove: 'bday:media-remove',
  modalMediaFile: 'bday:m:media-file',
  modalMediaLink: 'bday:m:media-link',
  // suppression
  del: 'bday:delete',
  delConfirm: 'bday:delete-confirm',
};

const EPHEMERAL = MessageFlags.Ephemeral;
const NO_MENTIONS = { parse: [] };
const DEFAULT_TZ = 'Europe/Paris';
const MAX_URL_LENGTH = 400;
const SESSION_TTL_MS = 10 * 60_000; // < 15 min: durée de validité du jeton d'une interaction

const button = (id, label, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const backButton = () => button(ID.back, 'Retour', '↩️');

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
    components: [row(
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
  const today = nowIn(config?.timezone ?? DEFAULT_TZ);

  const announcement = buildAnnouncement({ birthday: b, config, name, year: nextBirthdayYear(b, today) });
  const quoted = announcement.content.split('\n').map((l) => `> ${l}`).join('\n');
  const where = config?.channel_id
    ? `à ${config.hour}h dans <#${config.channel_id}>`
    : '… dès qu\'un admin aura choisi le salon (`/anniversaire-config`)';

  const hasMedia = Boolean(b.media_path || b.media_url);
  const extra = row();
  if (b.message) extra.addComponents(button(ID.textReset, 'Message par défaut', '↩️'));
  if (hasMedia) extra.addComponents(button(ID.mediaRemove, 'Retirer le média', '🚫'));
  extra.addComponents(button(ID.del, 'Tout supprimer', '🗑️', ButtonStyle.Danger));

  return {
    content: [
      notice,
      `### 🎂 Ton anniversaire: **${formatDate(b)}**`,
      `-# Aperçu du message posté le jour J ${where}`,
      quoted,
    ].filter(Boolean).join('\n'),
    files: announcement.files ?? [],
    components: [
      row(
        button(ID.text, 'Modifier mon message', '✏️', ButtonStyle.Primary),
        button(ID.media, hasMedia ? 'Changer le média' : 'Ajouter un média', '🖼️', ButtonStyle.Primary),
        button(ID.date, 'Changer la date', '📅'),
      ),
      extra,
    ],
    allowedMentions: NO_MENTIONS,
  };
}

const screen = (content, ...rows) => ({ content, files: [], components: rows, allowedMentions: NO_MENTIONS });

/** Répond sur place si on clique depuis un message privé, sinon crée un nouveau message privé. */
async function respond(i, payload) {
  const fromDashboard = i.isFromMessage?.() && i.message.flags.has(EPHEMERAL);
  if (fromDashboard) return i.update({ ...payload, attachments: [] });
  return i.reply({ ...payload, flags: EPHEMERAL });
}

/** Variante après un `deferUpdate` (opérations longues: téléchargement de média). */
const respondDeferred = (i, payload) => i.editReply({ ...payload, attachments: [] });

const nameOf = (i) => i.member?.displayName ?? i.user.displayName ?? i.user.username;
const dash = (i, extra = {}) =>
  buildDashboard({ guildId: i.guildId, userId: i.user.id, name: nameOf(i), ...extra });

// ───────────────────────── Sélecteur de date (« calendrier ») ─────────────────────────
// Discord n'a pas de composant calendrier: trois listes déroulantes (mois, jours 1-15, jours 16-31;
// une liste est limitée à 25 choix) + année facultative. État gardé en mémoire le temps de la saisie.

const pickers = new Map(); // `${guild}:${user}` -> {month, day, year, exp}
const pickerKey = (i) => `${i.guildId}:${i.user.id}`;

function pickerState(i, init) {
  const cur = pickers.get(pickerKey(i));
  const state = cur && cur.exp > Date.now() ? cur : { month: null, day: null, year: null, ...init };
  state.exp = Date.now() + SESSION_TTL_MS;
  pickers.set(pickerKey(i), state);
  return state;
}

function pickerScreen(state, notice = null) {
  const daySelect = (id, from, to, placeholder) => new StringSelectMenuBuilder()
    .setCustomId(id).setPlaceholder(placeholder)
    .addOptions(Array.from({ length: to - from + 1 }, (_, k) => {
      const d = from + k;
      return { label: String(d), value: String(d), default: state.day === d };
    }));
  const month = new StringSelectMenuBuilder().setCustomId(ID.pickMonth).setPlaceholder('Mois')
    .addOptions(MONTH_NAMES.map((n, k) => ({
      label: n[0].toUpperCase() + n.slice(1), value: String(k + 1), default: state.month === k + 1,
    })));

  const summary = `**Mois:** ${state.month ? MONTH_NAMES[state.month - 1] : '—'} · **Jour:** ${state.day ?? '—'} · **Année:** ${state.year ?? '— (facultative)'}`;
  return screen(
    [notice, '### 📅 Quand est ton anniversaire ?', 'Choisis ton **mois** et ton **jour** dans les listes.', summary].filter(Boolean).join('\n'),
    row(month),
    row(daySelect(ID.pickDayA, 1, 15, 'Jour (1 à 15)')),
    row(daySelect(ID.pickDayB, 16, 31, 'Jour (16 à 31)')),
    row(
      button(ID.pickYear, 'Année (facultatif)', '🎈'),
      button(ID.dateType, 'Écrire la date', '✍️'),
      button(ID.pickOk, 'Valider', '✅', ButtonStyle.Success).setDisabled(!(state.month && state.day)),
    ),
  );
}

// ───────────────────────── Fenêtres de saisie ─────────────────────────

const textInput = (id, style) => new TextInputBuilder().setCustomId(id).setStyle(style);

function dateModal() {
  return new ModalBuilder().setCustomId(ID.modalDate).setTitle('Ton anniversaire').addLabelComponents(
    new LabelBuilder()
      .setLabel('Ta date de naissance')
      .setDescription('Jour et mois suffisent. L\'année est facultative (elle sert à afficher ton âge).')
      .setTextInputComponent(textInput('date', TextInputStyle.Short)
        .setRequired(true).setMaxLength(30).setPlaceholder('ex : 06/11/2000 ou 6 novembre')),
  );
}

function yearModal(current) {
  const input = textInput('year', TextInputStyle.Short)
    .setRequired(false).setMaxLength(4).setMinLength(0).setPlaceholder('ex : 2000');
  if (current) input.setValue(String(current));
  return new ModalBuilder().setCustomId(ID.modalYear).setTitle('Année de naissance').addLabelComponents(
    new LabelBuilder()
      .setLabel('Année (facultatif)')
      .setDescription('Sert uniquement à afficher ton âge. Laisse vide pour ne pas la donner.')
      .setTextInputComponent(input),
  );
}

function textModal(current, config) {
  return new ModalBuilder().setCustomId(ID.modalText).setTitle('Ton message').addLabelComponents(
    new LabelBuilder()
      .setLabel('Message d\'anniversaire')
      .setDescription('{user} = ta mention · {nom} = ton pseudo · {age} = ton âge · {date} = ta date')
      .setTextInputComponent(textInput('text', TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(MAX_MESSAGE_LENGTH).setValue(current.message ?? effectiveDefault(config))),
  );
}

const mediaFileModal = () => new ModalBuilder().setCustomId(ID.modalMediaFile).setTitle('Ton média').addLabelComponents(
  new LabelBuilder()
    .setLabel('Image, GIF ou vidéo')
    .setDescription('10 Mo maximum (png, jpg, gif, webp, mp4, webm, mov).')
    .setFileUploadComponent(new FileUploadBuilder().setCustomId('file').setRequired(true).setMinValues(1).setMaxValues(1)),
);

const mediaLinkModal = () => new ModalBuilder().setCustomId(ID.modalMediaLink).setTitle('Ton média').addLabelComponents(
  new LabelBuilder()
    .setLabel('Lien')
    .setDescription('Tenor, Giphy, YouTube, lien d\'image…')
    .setTextInputComponent(textInput('url', TextInputStyle.Short)
      .setRequired(true).setMaxLength(MAX_URL_LENGTH).setPlaceholder('https://…')),
);

// ───────────────────────── Média: menu, GIF via messages privés ─────────────────────────

const mediaMenu = () => screen(
  '### 🖼️ Ajouter un média\nComment veux-tu l\'ajouter ?',
  row(
    button(ID.mediaGif, 'Choisir un GIF', '🎞️', ButtonStyle.Primary),
    button(ID.mediaFile, 'Depuis mon appareil', '📤'),
    button(ID.mediaLink, 'Avec un lien', '🔗'),
  ),
  row(backButton()),
);

// Le sélecteur GIF/stickers de Discord n'existe que dans la zone de message, pas dans les fenêtres de
// saisie. On le fait donc utiliser en message privé avec le bot (le contenu des MP est lisible sans
// intention privilégiée), puis on récupère le GIF envoyé et on met à jour le message du tableau de bord.

const gifSessions = new Map(); // userId -> {guildId, interaction, exp}

async function startGifSession(i) {
  try {
    const dm = await i.user.createDM();
    await dm.send(
      '🎞️ **Envoie-moi ton GIF ici !**\n'
      + 'Clique sur le bouton **GIF** (ou **sticker**) à côté de la zone de message, choisis, et envoie. '
      + 'Tu peux aussi coller un lien, une image ou une vidéo. Je m\'occupe du reste.',
    );
    gifSessions.set(i.user.id, { guildId: i.guildId, interaction: i, exp: Date.now() + SESSION_TTL_MS });
    return respond(i, screen(
      '### 🎞️ Ça se passe dans tes messages privés\nJe viens de t\'écrire: choisis ton GIF avec le bouton GIF, envoie-le, et ce message se mettra à jour tout seul.',
      row(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ouvrir la conversation').setEmoji('💬')
          .setURL(`https://discord.com/channels/@me/${dm.id}`),
        backButton(),
      ),
    ));
  } catch (err) {
    if (err.code !== 50007) throw err; // 50007: MP fermés
    return respond(i, screen(
      '### ❌ Je ne peux pas t\'écrire en privé\nAutorise les messages privés des membres de ce serveur (Paramètres du serveur → Paramètres de confidentialité), ou choisis une autre méthode.',
      row(button(ID.mediaFile, 'Depuis mon appareil', '📤'), button(ID.mediaLink, 'Avec un lien', '🔗'), backButton()),
    ));
  }
}

const URL_IN_TEXT = /https?:\/\/\S+/;

async function mediaFromDirectMessage(message, guildId) {
  const attachment = message.attachments.first();
  if (attachment) {
    const saved = await saveAttachment(guildId, message.author.id, attachment);
    return { path: saved.path, name: saved.name, url: null };
  }
  const sticker = message.stickers.first();
  if (sticker) {
    if (sticker.format === StickerFormatType.Lottie) {
      throw new Error('Ce sticker animé n\'est pas supporté. Choisis plutôt un GIF ou un sticker image.');
    }
    return { path: null, name: null, url: sticker.url };
  }
  const found = message.content.match(URL_IN_TEXT)?.[0];
  const url = found && parseMediaUrl(found);
  return url ? { path: null, name: null, url } : null;
}

/** Messages privés reçus: récupère le GIF/média d'une session ouverte depuis le tableau de bord. */
export async function handleDirectMessage(message) {
  if (message.guild || message.author.bot) return;
  const session = gifSessions.get(message.author.id);
  if (!session) return;
  if (session.exp < Date.now()) {
    gifSessions.delete(message.author.id);
    return message.reply('⌛ Cette demande a expiré. Retourne sur le serveur et clique de nouveau sur « Ajouter un média ».');
  }

  let media;
  try {
    media = await mediaFromDirectMessage(message, session.guildId);
  } catch (err) {
    return message.reply(`❌ ${err.message}`);
  }
  if (!media) return message.reply('🤔 Je n\'ai pas trouvé de GIF dans ton message. Utilise le bouton **GIF** à côté de la zone de message, puis envoie.');

  const { guildId, interaction } = session;
  const previous = getBirthday(guildId, message.author.id);
  if (!previous) {
    gifSessions.delete(message.author.id);
    await removeMediaFile(media.path);
    return message.reply('❌ Ton anniversaire n\'est plus enregistré sur ce serveur.');
  }
  setBirthdayMedia(guildId, message.author.id, media);
  await removeMediaFile(previous.media_path);
  gifSessions.delete(message.author.id);
  await message.reply('✅ C\'est enregistré ! Retourne sur le serveur: ton aperçu est à jour.');

  // Le jeton de l'interaction vit 15 min: au-delà (ou message privé fermé), le MP de confirmation suffit.
  await interaction.editReply({
    ...buildDashboard({ guildId, userId: message.author.id, name: nameOf(interaction), notice: '✅ Média enregistré.' }),
    attachments: [],
  }).catch(() => {});
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

/** Ouvre le parcours: sélecteur de date pour un nouveau, tableau de bord pour un inscrit. */
export async function openFlow(i) {
  if (!getBirthday(i.guildId, i.user.id)) {
    return i.reply({ ...pickerScreen(pickerState(i)), flags: EPHEMERAL });
  }
  return i.reply({ ...dash(i), flags: EPHEMERAL });
}

const retryDate = (message) => screen(message, row(button(ID.dateType, 'Réessayer', '✍️', ButtonStyle.Primary)));

async function saveDate(i, { day, month, year }) {
  const existed = Boolean(getBirthday(i.guildId, i.user.id));
  setBirthdayDate(i.guildId, i.user.id, day, month, year);
  pickers.delete(pickerKey(i));
  return respond(i, dash(i, { notice: existed ? null : '✅ C\'est enregistré ! Tu peux maintenant personnaliser ton message ⬇️' }));
}

/** Enregistre un média déjà prêt (après `deferUpdate`), supprime l'ancien fichier, rafraîchit le tableau de bord. */
async function applyMedia(i, produce) {
  await i.deferUpdate();
  let media;
  try {
    media = await produce();
  } catch (err) {
    return i.followUp({ content: `❌ ${err.message}`, flags: EPHEMERAL });
  }
  const previous = getBirthday(i.guildId, i.user.id);
  setBirthdayMedia(i.guildId, i.user.id, media);
  await removeMediaFile(previous?.media_path);
  return respondDeferred(i, dash(i, { notice: '✅ Média enregistré.' }));
}

const withBirthday = (fn) => (i) => (getBirthday(i.guildId, i.user.id) ? fn(i) : openFlow(i));

const pickDay = (i) => {
  const state = pickerState(i);
  state.day = Number(i.values[0]);
  return respond(i, pickerScreen(state));
};

const actions = {
  [ID.open]: openFlow,
  [ID.upcoming]: (i) => i.reply({ content: upcomingText(i.guildId), flags: EPHEMERAL, allowedMentions: NO_MENTIONS }),
  [ID.back]: withBirthday((i) => respond(i, dash(i))),

  // Date
  [ID.date]: (i) => {
    const b = getBirthday(i.guildId, i.user.id);
    pickers.delete(pickerKey(i));
    return respond(i, pickerScreen(pickerState(i, b ? { month: b.month, day: b.day, year: b.year } : {})));
  },
  [ID.dateType]: (i) => i.showModal(dateModal()),
  [ID.pickMonth]: (i) => {
    const state = pickerState(i);
    state.month = Number(i.values[0]);
    return respond(i, pickerScreen(state));
  },
  [ID.pickDayA]: pickDay,
  [ID.pickDayB]: pickDay,
  [ID.pickYear]: (i) => i.showModal(yearModal(pickerState(i).year)),
  async [ID.modalYear](i) {
    const state = pickerState(i);
    const raw = i.fields.getTextInputValue('year').trim();
    if (raw && !/^\d{4}$/.test(raw)) return respond(i, pickerScreen(state, '❌ L\'année doit avoir 4 chiffres (ex: 2000).'));
    state.year = raw ? Number(raw) : null;
    return respond(i, pickerScreen(state));
  },
  async [ID.pickOk](i) {
    const state = pickerState(i);
    if (!state.month || !state.day) return respond(i, pickerScreen(state, '❌ Choisis d\'abord un mois et un jour.'));
    const error = validateBirthday(state, new Date().getFullYear());
    if (error) return respond(i, pickerScreen(state, `❌ ${error}`));
    return saveDate(i, state);
  },
  async [ID.modalDate](i) {
    const parsed = parseBirthdayInput(i.fields.getTextInputValue('date'));
    const error = parsed ? validateBirthday(parsed, new Date().getFullYear()) : 'Je n\'ai pas compris cette date.';
    if (error) {
      return i.reply({ ...retryDate(`❌ ${error}\nÉcris par exemple **06/11/2000** ou **6 novembre** (l'année est facultative).`), flags: EPHEMERAL });
    }
    return saveDate(i, parsed);
  },

  // Texte
  [ID.text]: withBirthday((i) => i.showModal(textModal(getBirthday(i.guildId, i.user.id), getGuildConfig(i.guildId)))),
  async [ID.textReset](i) {
    setBirthdayMessage(i.guildId, i.user.id, null);
    return respond(i, dash(i, { notice: '↩️ Message par défaut rétabli.' }));
  },
  async [ID.modalText](i) {
    const text = i.fields.getTextInputValue('text').trim();
    // Texte vide ou identique au défaut: on suit le défaut (il évolue avec la config du serveur).
    setBirthdayMessage(i.guildId, i.user.id, !text || text === effectiveDefault(getGuildConfig(i.guildId)) ? null : text);
    return respond(i, dash(i, { notice: '✅ Message enregistré.' }));
  },

  // Média
  [ID.media]: withBirthday((i) => respond(i, mediaMenu())),
  [ID.mediaGif]: withBirthday(startGifSession),
  [ID.mediaFile]: withBirthday((i) => i.showModal(mediaFileModal())),
  [ID.mediaLink]: withBirthday((i) => i.showModal(mediaLinkModal())),
  [ID.modalMediaFile]: (i) => applyMedia(i, async () => {
    const file = i.fields.getUploadedFiles('file')?.first();
    if (!file) throw new Error('Aucun fichier reçu.');
    const saved = await saveAttachment(i.guildId, i.user.id, file);
    return { path: saved.path, name: saved.name, url: null };
  }),
  [ID.modalMediaLink]: (i) => applyMedia(i, async () => {
    const url = parseMediaUrl(i.fields.getTextInputValue('url'));
    if (!url) throw new Error('Lien invalide (il doit commencer par http:// ou https://).');
    return { path: null, name: null, url };
  }),
  async [ID.mediaRemove](i) {
    const b = getBirthday(i.guildId, i.user.id);
    setBirthdayMedia(i.guildId, i.user.id, null);
    await removeMediaFile(b?.media_path);
    return respond(i, dash(i, { notice: '🚫 Média retiré.' }));
  },

  // Suppression
  [ID.del]: (i) => respond(i, screen(
    '### 🗑️ Tout supprimer ?\nTa date, ton message et ton média seront effacés. Tu ne seras plus fêté·e.',
    row(button(ID.delConfirm, 'Oui, supprimer', '🗑️', ButtonStyle.Danger), button(ID.back, 'Non, garder', '↩️')),
  )),
  async [ID.delConfirm](i) {
    const b = getBirthday(i.guildId, i.user.id);
    await removeMediaFile(b?.media_path);
    deleteBirthday(i.guildId, i.user.id);
    return respond(i, screen('🗑️ C\'est fait, tout est supprimé. Tu peux revenir quand tu veux !'));
  },
};

/** Boutons, listes et fenêtres du parcours (customId `bday:*`). Retourne false si l'interaction n'est pas pour nous. */
export async function handlePanelInteraction(i) {
  if (!(i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) || !i.guildId) return false;
  const action = actions[i.customId];
  if (!action) return false;
  await action(i);
  return true;
}
