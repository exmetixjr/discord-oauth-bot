const { SlashCommandBuilder } = require('discord.js');
const { connectDB } = require('../../api/utils/db');

module.exports = {
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('joinuser')
    .setDescription('Force-join an authorized user to this server')
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('Discord User ID to join')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.options.getString('userid');
    const guildId = interaction.guild.id;
    const db = await connectDB();
    const user = await db.collection('authorized_users').findOne({ userId });
    if (!user) return interaction.editReply(`❌ User \`${userId}\` has not authorized the bot.`);
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: user.accessToken }),
      }
    );
    if (response.status === 201) return interaction.editReply(`✅ Added **${user.globalName || user.username}**!`);
    else if (response.status === 204) return interaction.editReply(`ℹ️ Already in server.`);
    else {
      const err = await response.json();
      return interaction.editReply(`❌ Failed: \`${JSON.stringify(err)}\``);
    }
  },
};
