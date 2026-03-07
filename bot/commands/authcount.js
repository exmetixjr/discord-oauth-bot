const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectDB } = require('../../api/utils/db');

module.exports = {
  restricted: true,
  data: new SlashCommandBuilder().setName('authcount').setDescription('Show authorization statistics'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const db = await connectDB();
    const col = db.collection('authorized_users');
    const total = await col.countDocuments();
    const valid = await col.countDocuments({ tokenExpires: { $gt: new Date() } });
    const last24h = await col.countDocuments({ authorizedAt: { $gt: new Date(Date.now()-86400000) } });
    const last7d = await col.countDocuments({ authorizedAt: { $gt: new Date(Date.now()-604800000) } });
    const embed = new EmbedBuilder().setTitle('📊 Authorization Stats').setColor(0x57f287)
      .addFields(
        { name: '👥 Total', value: `**${total}**`, inline: true },
        { name: '🟢 Valid Tokens', value: `**${valid}**`, inline: true },
        { name: '🔴 Expired', value: `**${total-valid}**`, inline: true },
        { name: '📅 Last 24h', value: `**${last24h}** new`, inline: true },
        { name: '📆 Last 7 Days', value: `**${last7d}** new`, inline: true },
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
