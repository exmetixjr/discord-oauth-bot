const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectDB } = require('../../api/utils/db');

module.exports = {
  restricted: true,
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Look up an authorized user by ID or username')
    .addStringOption(opt => opt.setName('query').setDescription('User ID or username').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const query = interaction.options.getString('query').trim();
    const db = await connectDB();
    const col = db.collection('authorized_users');
    let users = [];

    if (/^\d{17,20}$/.test(query)) {
      const u = await col.findOne({ userId: query });
      if (u) users = [u];
    }
    if (users.length === 0) {
      users = await col.find({ $or: [{ username: { $regex: query, $options: 'i' } }, { globalName: { $regex: query, $options: 'i' } }] }).limit(5).toArray();
    }
    if (users.length === 0) return interaction.editReply(`❌ No authorized users found matching \`${query}\`.`);

    if (users.length > 1) {
      const list = users.map((u, i) => `\`${i+1}.\` **${u.globalName||u.username}** (\`${u.userId}\`) — <t:${Math.floor(new Date(u.authorizedAt).getTime()/1000)}:R>`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🔍 Results for "${query}"`).setDescription(list).setColor(0xffa500).setFooter({ text: 'Use exact User ID for full details' })] });
    }

    const u = users[0];
    const avatarURL = u.avatar ? `https://cdn.discordapp.com/avatars/${u.userId}/${u.avatar}.png?size=256` : `https://cdn.discordapp.com/embed/avatars/0.png`;
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${u.globalName||u.username}`).setThumbnail(avatarURL).setColor(0x7289da)
      .addFields(
        { name: '🆔 User ID', value: `\`${u.userId}\``, inline: true },
        { name: '📛 Username', value: `\`${u.username}\``, inline: true },
        { name: '✅ First Authorized', value: u.firstAuthorizedAt ? `<t:${Math.floor(new Date(u.firstAuthorizedAt).getTime()/1000)}:F>` : 'N/A', inline: false },
        { name: '🔄 Last Authorized', value: `<t:${Math.floor(new Date(u.authorizedAt).getTime()/1000)}:F>`, inline: false },
        { name: '⏳ Token Expires', value: u.tokenExpires ? `<t:${Math.floor(new Date(u.tokenExpires).getTime()/1000)}:R>` : 'Unknown', inline: true },
        { name: '🔑 Token Status', value: new Date(u.tokenExpires) > new Date() ? '🟢 Valid' : '🔴 Expired', inline: true },
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
