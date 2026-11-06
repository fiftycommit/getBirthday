import { writeFileSync } from 'node:fs';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { startBackupSchedule } from './backup.js';
import { commandDefinitions, handleInteraction } from './commands.js';
import { startScheduler } from './scheduler.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis (voir .env.example).');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
const route = DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
  : Routes.applicationCommands(DISCORD_CLIENT_ID);
await rest.put(route, { body: commandDefinitions });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, (c) => {
  console.log(`Connecté en tant que ${c.user.tag}`);
  startBackupSchedule();
  startScheduler(c);
  // Battement de coeur lu par le HEALTHCHECK Docker: n'est écrit que tant que la gateway est connectée.
  const beat = () => c.ws.status === 0 && writeFileSync('/tmp/healthy', String(Date.now()));
  beat();
  setInterval(beat, 15_000);
});
client.on(Events.InteractionCreate, handleInteraction);
await client.login(DISCORD_TOKEN);
