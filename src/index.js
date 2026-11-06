import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
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
  startScheduler(c);
});
client.on(Events.InteractionCreate, handleInteraction);
await client.login(DISCORD_TOKEN);
