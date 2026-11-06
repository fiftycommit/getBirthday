import {
  ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH } from './dates.js';
import { getGuildConfig, saveGuildConfig } from './db.js';
import { buildPanel, handlePanelInteraction, openFlow, upcomingText } from './panel.js';

const VARIABLES = '`{user}` (mention), `{nom}`, `{age}`, `{date}`';
const EPHEMERAL = MessageFlags.Ephemeral;
const NO_MENTIONS = { parse: [] };

const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);
const salonOption = (o, description) => o.setName('salon').setDescription(description)
  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

export const commandDefinitions = [
  guildOnly(new SlashCommandBuilder()
    .setName('anniversaire')
    .setDescription('Ajoute ou modifie ton anniversaire (date, message, média)')),

  guildOnly(new SlashCommandBuilder()
    .setName('anniversaires')
    .setDescription('Les prochains anniversaires du serveur')),

  guildOnly(new SlashCommandBuilder()
    .setName('anniversaire-panneau')
    .setDescription('Poste le panneau « Ajouter mon anniversaire » (admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => salonOption(o, 'Salon où poster le panneau (ici par défaut)'))),

  guildOnly(new SlashCommandBuilder()
    .setName('anniversaire-config')
    .setDescription('Configure le bot d\'anniversaires (admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => salonOption(o, 'Salon où poster les annonces'))
    .addIntegerOption((o) => o.setName('heure').setDescription('Heure d\'annonce (0-23)').setMinValue(0).setMaxValue(23))
    .addStringOption((o) => o.setName('fuseau').setDescription('Fuseau horaire IANA, ex: Europe/Paris'))
    .addStringOption((o) => o.setName('message-defaut').setDescription('Message par défaut du serveur').setMaxLength(MAX_MESSAGE_LENGTH))
    .addBooleanOption((o) => o.setName('reinitialiser-message').setDescription('Revenir au message par défaut du bot'))),
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

async function handlePanelCommand(i) {
  const channel = i.options.getChannel('salon') ?? i.channel;
  const perms = channel.permissionsFor(i.guild.members.me);
  const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks'].filter((p) => !perms?.has(p));
  if (missing.length) return reply(i, `❌ Permissions manquantes pour le bot dans ${channel}: ${missing.join(', ')}.`);
  await channel.send(buildPanel());
  const config = getGuildConfig(i.guildId);
  const hint = config?.channel_id ? '' : '\n⚠️ Pense aussi à choisir le salon des annonces: `/anniversaire-config salon:`.';
  return reply(i, `✅ Panneau posté dans ${channel}.${hint}`);
}

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
  if (!i.guildId) return;
  try {
    // Bot invité avec le seul scope `applications.commands`: les commandes arrivent mais le bot n'est pas
    // membre du serveur (i.guild nul) et ne pourrait ni lire les salons ni poster d'annonce.
    if (!i.guild) {
      return await i.reply({
        content: '❌ Je ne suis pas membre de ce serveur. Un admin doit m\'inviter avec le scope **bot** (en plus de applications.commands).',
        flags: EPHEMERAL,
      });
    }
    if (i.isChatInputCommand()) {
      if (i.commandName === 'anniversaire') return await openFlow(i);
      if (i.commandName === 'anniversaires') return await reply(i, upcomingText(i.guildId));
      if (i.commandName === 'anniversaire-panneau') return await handlePanelCommand(i);
      if (i.commandName === 'anniversaire-config') return await handleConfig(i);
      return;
    }
    await handlePanelInteraction(i);
  } catch (err) {
    console.error(`interaction ${i.commandName ?? i.customId}`, err);
    const msg = { content: '❌ Erreur interne.', flags: EPHEMERAL };
    if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
    else await i.reply(msg).catch(() => {});
  }
}
