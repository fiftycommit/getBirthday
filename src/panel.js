// Interface « zéro commande »: un panneau public avec un bouton, puis un tableau de bord privé
// (message éphémère) qui se met à jour sur place et montre toujours l'aperçu exact de l'annonce.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, FileUploadBuilder,
  LabelBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, ModalBuilder, StickerFormatType, StringSelectMenuBuilder, TextDisplayBuilder,
  TextInputBuilder, TextInputStyle,
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
import { GiphyError, giphyEnabled, searchGifs, trendingGifs } from './giphy.js';
import { parseMediaUrl, previewUrlFor, removeMediaFile, saveAttachment } from './media.js';

export const ID = {
  open: 'bday:open',
  upcoming: 'bday:upcoming',
  back: 'bday:back',
  // date
  date: 'bday:date',
  modalDate: 'bday:m:date',
  // texte
  text: 'bday:text',
  textReset: 'bday:text-reset',
  modalText: 'bday:m:text',
  // média
  media: 'bday:media',
  mediaGif: 'bday:media-gif',
  gifSearch: 'bday:gif-search',
  gifQuery: 'bday:gif-query',
  gifCategory: 'bday:gif-category',
  gifPrev: 'bday:gif-prev',
  gifNext: 'bday:gif-next',
  gifPick: ['bday:gif-pick-0', 'bday:gif-pick-1', 'bday:gif-pick-2', 'bday:gif-pick-3'],
  modalGif: 'bday:m:gif',
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
const V2 = MessageFlags.IsComponentsV2;
const NO_MENTIONS = { parse: [] };
const DEFAULT_TZ = 'Europe/Paris';
const MAX_URL_LENGTH = 400;
const SESSION_TTL_MS = 10 * 60_000; // < 15 min: durée de validité du jeton d'une interaction

const button = (id, label, emoji, style = ButtonStyle.Secondary) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
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
      button(ID.open, 'Mon anniversaire', '🎂', ButtonStyle.Primary),
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

  const files = announcement.files ?? [];
  const preview = files.length ? `attachment://${files[0].name}` : previewUrlFor(b.media_url);
  return v2({
    texts: [
      notice,
      `### 🎂 Ton anniversaire: **${formatDate(b)}**`,
      `-# Aperçu du message posté le jour J ${where}`,
      quoted,
    ].filter(Boolean),
    media: preview ? [preview] : [],
    files,
    rows: [
      row(
        button(ID.text, 'Modifier mon message', '✏️', ButtonStyle.Primary),
        button(ID.media, hasMedia ? 'Changer le média' : 'Ajouter un média', '🖼️', ButtonStyle.Primary),
        button(ID.date, 'Changer la date', '📅'),
      ),
      extra,
    ],
  });
}

/**
 * Écran « Components V2 »: un conteneur avec textes, galerie média facultative et rangées d'actions.
 * Tout le tableau de bord est en V2 car ce drapeau ne peut jamais être retiré d'un message: autant
 * que tous les écrans d'un même message privé soient du même format.
 */
function v2({ texts, before = [], media = [], files = [], rows = [], footer = null }) {
  const container = new ContainerBuilder().setAccentColor(0xf5a623)
    .addTextDisplayComponents(...texts.map((t) => new TextDisplayBuilder().setContent(t)));
  if (before.length) container.addActionRowComponents(...before); // ex: barre de recherche au-dessus de la galerie
  if (media.length) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(...media.map((url) => new MediaGalleryItemBuilder().setURL(url))),
    );
  }
  if (rows.length) container.addActionRowComponents(...rows);
  if (footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
  return { components: [container], files, flags: V2, allowedMentions: NO_MENTIONS };
}

const screen = (content, ...rows) => v2({ texts: [content], rows });
const ephemeral = (payload) => ({ ...payload, flags: (payload.flags ?? 0) | EPHEMERAL });

/** Répond sur place si on clique depuis un message privé, sinon crée un nouveau message privé. */
async function respond(i, payload) {
  const fromDashboard = i.isFromMessage?.() && i.message.flags.has(EPHEMERAL);
  // content/embeds remis à vide: un message privé antérieur au passage en V2 peut encore en porter.
  if (fromDashboard) return i.update({ content: null, embeds: [], ...payload, attachments: [] });
  return i.reply(ephemeral(payload));
}

/** Variante après un `deferUpdate` (opérations longues: téléchargement de média). */
const respondDeferred = (i, payload) => i.editReply({ content: null, embeds: [], ...payload, attachments: [] });

const nameOf = (i) => i.member?.displayName ?? i.user.displayName ?? i.user.username;
const dash = (i, extra = {}) =>
  buildDashboard({ guildId: i.guildId, userId: i.user.id, name: nameOf(i), ...extra });

// ───────────────────────── Fenêtres de saisie ─────────────────────────

const textInput = (id, style) => new TextInputBuilder().setCustomId(id).setStyle(style);

function dateModal(current) {
  const input = textInput('date', TextInputStyle.Short)
    .setRequired(true).setMaxLength(30).setPlaceholder('ex : 06/11/2000 ou 6 novembre');
  if (current) {
    const dd = String(current.day).padStart(2, '0');
    const mm = String(current.month).padStart(2, '0');
    input.setValue(`${dd}/${mm}${current.year ? `/${current.year}` : ''}`);
  }
  return new ModalBuilder().setCustomId(ID.modalDate).setTitle('Ton anniversaire').addLabelComponents(
    new LabelBuilder()
      .setLabel('Ta date de naissance')
      .setDescription('Jour et mois suffisent. L\'année est facultative (elle sert à afficher ton âge).')
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
    ...(giphyEnabled() ? [button(ID.gifSearch, 'Chercher un GIF', '🔎', ButtonStyle.Primary)] : []),
    button(ID.mediaGif, 'GIF / sticker Discord', '🎞️', giphyEnabled() ? ButtonStyle.Secondary : ButtonStyle.Primary),
    button(ID.mediaFile, 'Depuis mon appareil', '📤'),
    button(ID.mediaLink, 'Avec un lien', '🔗'),
  ),
  row(backButton()),
);

const gifSearchModal = () => new ModalBuilder().setCustomId(ID.modalGif).setTitle('Rechercher un GIF').addLabelComponents(
  new LabelBuilder()
    .setLabel('Rechercher sur GIPHY')
    .setTextInputComponent(textInput('query', TextInputStyle.Short)
      .setRequired(true).setMaxLength(50).setPlaceholder('🔍  fête, gâteau, champagne…')),
);

// Grille façon sélecteur Discord: 4 GIF à la fois (galerie de médias V2), tendances par défaut,
// la recherche remplace la liste. Résultats gardés en mémoire le temps du choix (redémarrage = nouvelle recherche).
const GIFS_PER_PAGE = 4;
// Raccourcis façon tuiles du sélecteur Discord: libellé affiché → mot recherché ('' = tendances).
const GIF_CATEGORIES = [
  { label: 'À la une', emoji: '🔥', value: '' },
  { label: 'Joyeux anniversaire', emoji: '🎂', value: 'joyeux anniversaire' },
  { label: 'Fête', emoji: '🎉', value: 'fête' },
  { label: 'Félicitations', emoji: '🥳', value: 'félicitations' },
  { label: 'LOL', emoji: '😂', value: 'lol' },
  { label: 'Amour', emoji: '❤️', value: 'love' },
  { label: 'Hello', emoji: '👋', value: 'hello' },
  { label: 'Merci', emoji: '🙏', value: 'merci' },
];
const gifSearches = new Map(); // `${guild}:${user}` -> {query|null, results, page, exp}

const gifPageCount = (state) => Math.ceil(state.results.length / GIFS_PER_PAGE);

function gifScreen(state) {
  const start = state.page * GIFS_PER_PAGE;
  const shown = state.results.slice(start, start + GIFS_PER_PAGE);
  const title = state.query ? `« ${state.query} »` : 'GIF recommandés';
  // Même ordre que le sélecteur de Discord: barre de recherche, catégories, grille, puis navigation.
  return v2({
    texts: [`### 🎞️ ${title}`],
    before: [
      row(button(ID.gifQuery, 'Rechercher sur GIPHY…', '🔍')),
      row(new StringSelectMenuBuilder().setCustomId(ID.gifCategory).setPlaceholder('Catégories: fête, LOL, amour…')
        .addOptions(GIF_CATEGORIES.map((c) => ({ label: c.label, emoji: c.emoji, value: c.value || 'trending' })))),
    ],
    media: shown.map((gif) => gif.preview),
    rows: [
      row(...shown.map((_, k) => button(ID.gifPick[k], String(k + 1), null, ButtonStyle.Success))),
      row(
        button(ID.gifPrev, 'Précédents', '◀️'),
        button(ID.gifNext, 'Suivants', '▶️'),
        backButton(),
      ),
    ],
    footer: `-# Page ${state.page + 1}/${gifPageCount(state)} · clique sur le numéro du GIF choisi (1 2 en haut, 3 4 en bas) · Powered by GIPHY`,
  });
}

const gifKey = (i) => `${i.guildId}:${i.user.id}`;
const liveGifSearch = (i) => {
  const state = gifSearches.get(gifKey(i));
  return state && state.exp > Date.now() ? state : null;
};

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
    content: null,
    embeds: [],
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

/** Ouvre le parcours: fenêtre de date pour un nouveau, tableau de bord pour un inscrit. */
export async function openFlow(i) {
  if (!getBirthday(i.guildId, i.user.id)) return i.showModal(dateModal(null));
  return i.reply(ephemeral(dash(i)));
}

const retryDate = (message) => screen(message, row(button(ID.date, 'Réessayer', '📅', ButtonStyle.Primary)));

async function saveDate(i, { day, month, year }) {
  const existed = Boolean(getBirthday(i.guildId, i.user.id));
  setBirthdayDate(i.guildId, i.user.id, day, month, year);
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

const gifExpired = () => screen('### ⌛ Cette recherche a expiré\nRelance-la, c\'est rapide.',
  row(button(ID.gifSearch, 'Chercher un GIF', '🔎', ButtonStyle.Primary), backButton()));

function gifStep(i, delta) {
  const state = liveGifSearch(i);
  if (!state) return respond(i, gifExpired());
  const n = gifPageCount(state);
  state.page = (state.page + delta + n) % n; // boucle aux extrémités
  state.exp = Date.now() + SESSION_TTL_MS;
  return respond(i, gifScreen(state));
}

/** Charge la liste (tendances si `query` est nul), ouvre la grille; erreurs expliquées avec rebond possible. */
async function showGifGrid(i, query) {
  await i.deferUpdate();
  let results;
  try {
    results = query ? await searchGifs(query) : await trendingGifs();
  } catch (err) {
    if (!(err instanceof GiphyError)) throw err;
    return respondDeferred(i, screen(`### ❌ ${err.message}\nTu peux réessayer plus tard ou choisir une autre méthode.`,
      row(button(ID.gifSearch, 'Réessayer', '🔎'), backButton())));
  }
  if (results.length === 0) {
    return respondDeferred(i, screen(`### 🤷 Aucun GIF pour « ${query} »\nEssaie un autre mot.`,
      row(button(ID.gifQuery, 'Autre recherche', '🔎', ButtonStyle.Primary), backButton())));
  }
  const state = { query, results, page: 0, exp: Date.now() + SESSION_TTL_MS };
  gifSearches.set(gifKey(i), state);
  return respondDeferred(i, gifScreen(state));
}

async function pickGif(i, slot) {
  const state = liveGifSearch(i);
  const gif = state?.results[state.page * GIFS_PER_PAGE + slot];
  if (!gif) return respond(i, gifExpired());
  const previous = getBirthday(i.guildId, i.user.id);
  setBirthdayMedia(i.guildId, i.user.id, { path: null, name: null, url: gif.url });
  await removeMediaFile(previous?.media_path);
  gifSearches.delete(gifKey(i));
  return respond(i, dash(i, { notice: '✅ GIF enregistré.' }));
}

const withBirthday = (fn) => (i) => (getBirthday(i.guildId, i.user.id) ? fn(i) : openFlow(i));

const actions = {
  [ID.open]: openFlow,
  [ID.upcoming]: (i) => i.reply({ content: upcomingText(i.guildId), flags: EPHEMERAL, allowedMentions: NO_MENTIONS }),
  [ID.back]: withBirthday((i) => respond(i, dash(i))),

  // Date
  [ID.date]: (i) => i.showModal(dateModal(getBirthday(i.guildId, i.user.id))),
  async [ID.modalDate](i) {
    const parsed = parseBirthdayInput(i.fields.getTextInputValue('date'));
    const error = parsed ? validateBirthday(parsed, new Date().getFullYear()) : 'Je n\'ai pas compris cette date.';
    if (error) {
      return i.reply(ephemeral(retryDate(`❌ ${error}\nÉcris par exemple **06/11/2000** ou **6 novembre** (l'année est facultative).`)));
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
  [ID.gifSearch]: withBirthday((i) => showGifGrid(i, null)),
  [ID.gifCategory]: (i) => showGifGrid(i, i.values[0] === 'trending' ? null : i.values[0]),
  [ID.gifQuery]: withBirthday((i) => i.showModal(gifSearchModal())),
  [ID.modalGif]: (i) => showGifGrid(i, i.fields.getTextInputValue('query').trim()),
  [ID.gifPrev]: (i) => gifStep(i, -1),
  [ID.gifNext]: (i) => gifStep(i, 1),
  ...Object.fromEntries(ID.gifPick.map((id, slot) => [id, (i) => pickGif(i, slot)])),
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
