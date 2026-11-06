import {
  ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { buildAnnouncement } from './announce.js';
import {
  DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH, daysUntil, formatDate, nowIn, validateBirthday,
} from './dates.js';
import {
  deleteBirthday, getBirthday, getGuildConfig, listBirthdays, saveGuildConfig,
  setBirthdayDate, setBirthdayMedia, setBirthdayMessage,
} from './db.js';
import { parseMediaUrl, removeMediaFile, saveAttachment } from './media.js';

const MAX_URL_LENGTH = 400;
const VARIABLES = '`{user}` (mention), `{nom}`, `{age}`, `{date}`';
const EPHEMERAL = MessageFlags.Ephemeral;
const NO_MENTIONS = { parse: [] };

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('anniversaire')
    .setDescription('Gère ton anniversaire')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s
      .setName('date').setDescription('Enregistre ta date d\'anniversaire')
      .addIntegerOption((o) => o.setName('jour').setDescription('Jour (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption((o) => o.setName('mois').setDescription('Mois (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption((o) => o.setName('annee').setDescription('Année de naissance (optionnel, pour afficher ton âge)').setMinValue(1900)))
    .addSubcommand((s) => s
      .setName('texte').setDescription('Personnalise ton message d\'anniversaire')
      .addStringOption((o) => o.setName('message').setDescription(`Variables: {user} {nom} {age} {date}`).setRequired(true).setMaxLength(MAX_MESSAGE_LENGTH)))
    .addSubcommand((s) => s
      .setName('media').setDescription('Ajoute une image, un gif ou une vidéo à ton message')
      .addAttachmentOption((o) => o.setName('fichier').setDescription('Image, gif ou vidéo (10 Mo max)'))
      .addStringOption((o) => o.setName('lien').setDescription('Lien (Tenor, Giphy, YouTube, image…)').setMaxLength(MAX_URL_LENGTH)))
    .addSubcommand((s) => s
      .setName('apercu').setDescription('Voir le message tel qu\'il sera posté (visible par toi seul)'))
    .addSubcommand((s) => s
      .setName('voir').setDescription('Voir l\'anniversaire de quelqu\'un')
      .addUserOption((o) => o.setName('membre').setDescription('Membre (toi par défaut)')))
    .addSubcommand((s) => s
      .setName('prochains').setDescription('Les prochains anniversaires du serveur'))
    .addSubcommand((s) => s
      .setName('retirer').setDescription('Retire des données enregistrées')
      .addStringOption((o) => o.setName('quoi').setDescription('Quoi retirer').setRequired(true).addChoices(
        { name: 'Mon texte perso', value: 'texte' },
        { name: 'Mon média', value: 'media' },
        { name: 'Tout (date comprise)', value: 'tout' },
      ))),

  new SlashCommandBuilder()
    .setName('anniversaire-config')
    .setDescription('Configure le bot d\'anniversaires (admins)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => o.setName('salon').setDescription('Salon où poster les annonces')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addIntegerOption((o) => o.setName('heure').setDescription('Heure d\'annonce (0-23)').setMinValue(0).setMaxValue(23))
    .addStringOption((o) => o.setName('fuseau').setDescription('Fuseau horaire IANA, ex: Europe/Paris'))
    .addStringOption((o) => o.setName('message-defaut').setDescription('Message par défaut du serveur').setMaxLength(MAX_MESSAGE_LENGTH))
    .addBooleanOption((o) => o.setName('reinitialiser-message').setDescription('Revenir au message par défaut du bot')),
].map((c) => c.toJSON());

const reply = (i, content, extra = {}) =>
  i.reply({ content, flags: EPHEMERAL, allowedMentions: NO_MENTIONS, ...extra });

const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const handlers = {
  async date(i) {
    const day = i.options.getInteger('jour', true);
    const month = i.options.getInteger('mois', true);
    const year = i.options.getInteger('annee');
    const error = validateBirthday({ day, month, year }, new Date().getFullYear());
    if (error) return reply(i, `❌ ${error}`);
    setBirthdayDate(i.guildId, i.user.id, day, month, year);
    const config = getGuildConfig(i.guildId);
    const hint = config?.channel_id
      ? ''
      : '\n⚠️ Aucun salon d\'annonce n\'est configuré pour l\'instant (`/anniversaire-config`).';
    return reply(i, `✅ Anniversaire enregistré: **${formatDate({ day, month, year })}**.${hint}`);
  },

  async texte(i) {
    if (!getBirthday(i.guildId, i.user.id)) return reply(i, '❌ Enregistre d\'abord ta date avec `/anniversaire date`.');
    const message = i.options.getString('message', true);
    setBirthdayMessage(i.guildId, i.user.id, message);
    return reply(i, `✅ Message enregistré. Variables: ${VARIABLES}. Vérifie avec \`/anniversaire apercu\`.`);
  },

  async media(i) {
    const current = getBirthday(i.guildId, i.user.id);
    if (!current) return reply(i, '❌ Enregistre d\'abord ta date avec `/anniversaire date`.');
    const attachment = i.options.getAttachment('fichier');
    const rawUrl = i.options.getString('lien');
    if (!attachment === !rawUrl) return reply(i, '❌ Donne soit un `fichier`, soit un `lien` (pas les deux).');

    await i.deferReply({ flags: EPHEMERAL });
    let media;
    try {
      if (attachment) {
        const saved = await saveAttachment(i.guildId, i.user.id, attachment);
        media = { path: saved.path, name: saved.name, url: null };
      } else {
        const url = parseMediaUrl(rawUrl);
        if (!url) return i.editReply('❌ Lien invalide (http/https requis).');
        media = { path: null, name: null, url };
      }
    } catch (err) {
      return i.editReply(`❌ ${err.message}`);
    }
    setBirthdayMedia(i.guildId, i.user.id, media);
    await removeMediaFile(current.media_path);
    return i.editReply('✅ Média enregistré. Vérifie avec `/anniversaire apercu`.');
  },

  async apercu(i) {
    const birthday = getBirthday(i.guildId, i.user.id);
    if (!birthday) return reply(i, '❌ Enregistre d\'abord ta date avec `/anniversaire date`.');
    const year = new Date().getFullYear();
    const payload = buildAnnouncement({
      birthday,
      config: getGuildConfig(i.guildId),
      name: i.member?.displayName ?? i.user.username,
      year,
    });
    if (birthday.year === null && /\{age\}/.test(birthday.message ?? '')) {
      payload.content += '\n\n_⚠️ `{age}` s\'affiche « ? » car tu n\'as pas renseigné ton année de naissance._';
    }
    return i.reply({ ...payload, flags: EPHEMERAL });
  },

  async voir(i) {
    const user = i.options.getUser('membre') ?? i.user;
    const b = getBirthday(i.guildId, user.id);
    if (!b) return reply(i, `${user.id === i.user.id ? 'Tu n\'as' : `${user.displayName} n'a`} pas enregistré d'anniversaire.`);
    return reply(i, `🎂 **${user.displayName}** — ${formatDate({ ...b, year: null })}`);
  },

  async prochains(i) {
    const tz = getGuildConfig(i.guildId)?.timezone ?? 'Europe/Paris';
    const today = nowIn(tz);
    const next = listBirthdays(i.guildId)
      .map((b) => ({ b, in: daysUntil(b, today) }))
      .sort((a, b) => a.in - b.in)
      .slice(0, 10);
    if (next.length === 0) return reply(i, 'Aucun anniversaire enregistré.');
    const lines = next.map(({ b, in: d }) => {
      const when = d === 0 ? '**aujourd\'hui** 🎉' : d === 1 ? 'demain' : `dans ${d} jours`;
      return `• <@${b.user_id}> — ${formatDate({ ...b, year: null })} (${when})`;
    });
    return i.reply({ content: lines.join('\n'), allowedMentions: NO_MENTIONS });
  },

  async retirer(i) {
    const what = i.options.getString('quoi', true);
    const b = getBirthday(i.guildId, i.user.id);
    if (!b) return reply(i, 'Rien à retirer.');
    if (what === 'tout') {
      await removeMediaFile(b.media_path);
      deleteBirthday(i.guildId, i.user.id);
      return reply(i, '🗑️ Toutes tes données ont été supprimées.');
    }
    if (what === 'texte') setBirthdayMessage(i.guildId, i.user.id, null);
    if (what === 'media') {
      setBirthdayMedia(i.guildId, i.user.id, null);
      await removeMediaFile(b.media_path);
    }
    return reply(i, '🗑️ Retiré.');
  },
};

async function handleConfig(i) {
  const channel = i.options.getChannel('salon');
  const hour = i.options.getInteger('heure');
  const timezone = i.options.getString('fuseau');
  const defaultMessage = i.options.getString('message-defaut');
  const resetMessage = i.options.getBoolean('reinitialiser-message');

  if (timezone && !isValidTimeZone(timezone)) return reply(i, '❌ Fuseau inconnu (ex: `Europe/Paris`).');

  const patch = {};
  const warnings = [];
  if (channel) {
    patch.channel_id = channel.id;
    const perms = channel.permissionsFor(i.guild.members.me);
    const missing = ['ViewChannel', 'SendMessages', 'AttachFiles'].filter((p) => !perms?.has(p));
    if (missing.length) warnings.push(`⚠️ Permissions manquantes pour le bot dans ce salon: ${missing.join(', ')}.`);
  }
  if (hour !== null) patch.hour = hour;
  if (timezone) patch.timezone = timezone;
  if (resetMessage) patch.default_message = null;
  else if (defaultMessage) patch.default_message = defaultMessage;

  const config = Object.keys(patch).length ? saveGuildConfig(i.guildId, patch) : getGuildConfig(i.guildId);
  const lines = [
    '**Configuration**',
    `Salon: ${config?.channel_id ? `<#${config.channel_id}>` : '_non défini_'}`,
    `Heure: ${config?.hour ?? 9}h (${config?.timezone ?? 'Europe/Paris'})`,
    `Message par défaut: ${config?.default_message ?? DEFAULT_MESSAGE}`,
    `Variables: ${VARIABLES}`,
    ...warnings,
  ];
  return reply(i, lines.join('\n'));
}

export async function handleInteraction(i) {
  if (!i.isChatInputCommand() || !i.guildId) return;
  try {
    if (i.commandName === 'anniversaire-config') return await handleConfig(i);
    if (i.commandName === 'anniversaire') return await handlers[i.options.getSubcommand()](i);
  } catch (err) {
    console.error(`/${i.commandName}`, err);
    const msg = { content: '❌ Erreur interne.', flags: EPHEMERAL };
    if (i.deferred || i.replied) await i.editReply(msg).catch(() => {});
    else await i.reply(msg).catch(() => {});
  }
}
