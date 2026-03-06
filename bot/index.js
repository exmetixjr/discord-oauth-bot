require('dotenv').config({ path: '../.env' });
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessages,
  ],
});

// Load slash commands dynamically
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
  console.log(`📌 Loaded command: /${command.data.name}`);
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Owner-only protection
  if (command.ownerOnly && interaction.user.id !== process.env.BOT_OWNER_ID) {
    return interaction.reply({
      content: '❌ This command is restricted to the bot owner.',
      ephemeral: true,
    });
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const reply = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.BOT_TOKEN);