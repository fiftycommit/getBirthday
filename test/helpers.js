import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Collection, MessageFlags } from 'discord.js';

/** Doit être appelé AVANT tout import de src/db.js (le chemin est lu à l'import). */
export function useTempDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'getbirthday-test-'));
  process.env.DATA_DIR = dir;
  return dir;
}

/**
 * Fausse interaction Discord. `kind`: 'command' | 'button' | 'select' | 'modal'.
 * `fromEphemeral`: le bouton/la fenêtre vient d'un message privé (tableau de bord) — sinon du panneau public.
 * `calls` garde l'ordre des appels (reply/update/showModal/…) pour vérifier le comportement observable.
 */
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
    isFromMessage: () => kind !== 'command' && fromEphemeral !== null,
    message: { flags: { has: (f) => fromEphemeral && f === MessageFlags.Ephemeral } },
    options: { getChannel: get, getInteger: get, getString: get, getBoolean: get },
    fields: {
      getTextInputValue: (k) => fields[k] ?? '',
      getUploadedFiles: () => (files ? new Collection(files.map((f, n) => [String(n), f])) : null),
    },
    reply: rec('reply'), update: rec('update'), showModal: rec('showModal'),
    deferUpdate: rec('deferUpdate'), editReply: rec('editReply'), followUp: rec('followUp'),
  };
  const last = (type) => calls.filter((c) => c.type === type).at(-1)?.payload;
  const text = () => calls.map((c) => c.payload?.content ?? '').join('\n');
  return { interaction, calls, last, text };
}
