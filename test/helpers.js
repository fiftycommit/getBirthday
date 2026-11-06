import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Collection, MessageFlags } from 'discord.js';

// À appeler avant l'import de src/db.js, qui lit DATA_DIR au chargement.
export function useTempDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'getbirthday-test-'));
  process.env.DATA_DIR = dir;
  return dir;
}

// Simule une interaction Discord et conserve les appels dans l'ordre.
// fromEphemeral indique si l'interaction vient du tableau de bord privé.
export function fakeInteraction({
  kind = 'command', guildId = 'G', userId = 'U', commandName = 'anniversaire', customId,
  opts = {}, fields = {}, files = null, fromEphemeral = false, channel = null, values = [], dm = null,
}) {
  const calls = [];
  const rec = (type) => async (payload) => { calls.push({ type, payload }); };
  const get = (k) => opts[k] ?? null;
  const interaction = {
    guildId,
    commandName,
    customId,
    user: { id: userId, username: 'user', displayName: 'User', createDM: async () => { if (dm instanceof Error) throw dm; return dm; } },
    values,
    member: { displayName: 'User' },
    channel,
    guild: { members: { me: {} } },
    deferred: false,
    replied: false,
    isChatInputCommand: () => kind === 'command',
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    isFromMessage: kind === 'modal' ? () => fromEphemeral !== null : undefined,
    message: { flags: { has: (f) => fromEphemeral && f === MessageFlags.Ephemeral } },
    options: { getChannel: get, getInteger: get, getString: get, getBoolean: get },
    fields: {
      getTextInputValue: (k) => fields[k] ?? '',
      getStringSelectValues: (k) => [].concat(fields[k] ?? []).map(String),
      getUploadedFiles: () => (files ? new Collection(files.map((f, n) => [String(n), f])) : null),
    },
    reply: rec('reply'), update: rec('update'), showModal: rec('showModal'),
    deferUpdate: rec('deferUpdate'), editReply: rec('editReply'), followUp: rec('followUp'), deleteReply: rec('deleteReply'),
  };
  const last = (type) => calls.filter((c) => c.type === type).at(-1)?.payload;
  const text = () => calls.map((c) => c.payload?.content ?? '').join('\n');
  return { interaction, calls, last, text };
}

// Extrait les textes, identifiants, médias et liens d'un message V1 ou V2.
export function view(payload) {
  const out = { content: payload?.content ?? '', ids: [], media: [], links: [] };
  const texts = payload?.content ? [payload.content] : [];
  const walk = (c) => {
    const j = c.toJSON ? c.toJSON() : c;
    if (j.type === 10) texts.push(j.content);
    if (j.type === 12) j.items.forEach((it) => out.media.push(it.media.url));
    if (j.type === 2 || j.type === 3) (j.custom_id ? out.ids.push(j.custom_id) : out.links.push(j.url));
    (j.components ?? []).forEach(walk);
  };
  (payload?.components ?? []).forEach(walk);
  out.content = texts.join('\n');
  return out;
}
