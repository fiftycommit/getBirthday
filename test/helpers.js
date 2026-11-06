import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Doit être appelé AVANT tout import de src/db.js (le chemin est lu à l'import). */
export function useTempDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'getbirthday-test-'));
  process.env.DATA_DIR = dir;
  return dir;
}

export function fakeInteraction({ guildId = 'G', userId = 'U', command = 'anniversaire', sub, opts = {} }) {
  const out = { replies: [] };
  const get = (k) => opts[k] ?? null;
  const interaction = {
    isChatInputCommand: () => true,
    guildId,
    commandName: command,
    user: { id: userId, username: 'user', displayName: 'User' },
    member: { displayName: 'User' },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => sub,
      getInteger: get, getString: get, getAttachment: get, getUser: get, getChannel: get, getBoolean: get,
    },
    reply: async (x) => { out.replies.push(x); },
    deferReply: async () => {},
    editReply: async (x) => { out.replies.push(x); },
  };
  return { interaction, out, text: () => out.replies.map((r) => (typeof r === 'string' ? r : r.content)).join('\n') };
}
