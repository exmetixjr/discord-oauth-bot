require('dotenv').config({ path: '../.env' });
const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { hasPermission } = require('./utils/permissions');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
  console.log(`📌 Loaded command: /${command.data.name}`);
}

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📡 Serving ${client.guilds.cache.size} servers`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  if (command.restricted) {
    const allowed = await hasPermission(interaction.user.id);
    if (!allowed) return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
  }

  if (command.ownerOnly && interaction.user.id !== process.env.BOT_OWNER_ID) {
    return interaction.reply({ content: '❌ This command is restricted to the bot owner only.', flags: MessageFlags.Ephemeral });
  }

  try {
    await command.execute(interaction, client);
  } catch (err) {
    console.error(`❌ Error in /${interaction.commandName}:`, err);
    const payload = { content: `❌ Error: \`${err.message}\``, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
});

client.login(process.env.BOT_TOKEN);
