// bot/commands/joinall.js
const { SlashCommandBuilder } = require('discord.js');
const { connectDB } = require('../../api/utils/db');

// Rate limit: Discord allows ~10 guild member adds per 10 seconds
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('joinall')
    .setDescription('Force-join ALL authorized users to this server')
    .addBooleanOption(opt =>
      opt.setName('confirm')
        .setDescription('Set to true to confirm this action')
        .setRequired(true)
    ),

  async execute(interaction) {
    const confirm = interaction.options.getBoolean('confirm');
    if (!confirm) {
      return interaction.reply({ content: '❌ Set `confirm: True` to proceed.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const db = await connectDB();
    const users = await db.collection('authorized_users').find({}).toArray();

    if (users.length === 0) {
      return interaction.editReply('📭 No authorized users to join.');
    }

    await interaction.editReply(`⏳ Starting to join **${users.length}** users... This will take a while.`);

    let added = 0, already = 0, failed = 0;

    for (const user of users) {
      try {
        const response = await fetch(
          `https://discord.com/api/v10/guilds/${guildId}/members/${user.userId}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bot ${process.env.BOT_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ access_token: user.accessToken }),
          }
        );

        if (response.status === 201) added++;
        else if (response.status === 204) already++;
        else failed++;

        // Respect Discord rate limits — 1 second between requests to be safe
        await sleep(1000);

      } catch {
        failed++;
        await sleep(1000);
      }
    }

    await interaction.followUp({
      content: `✅ **Join All Complete!**\n\n` +
               `➕ Added: **${added}**\n` +
               `🔁 Already in server: **${already}**\n` +
               `❌ Failed: **${failed}**`,
      ephemeral: true,
    });
  },
};