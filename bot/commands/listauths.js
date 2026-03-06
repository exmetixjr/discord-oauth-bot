// bot/commands/listauths.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectDB } = require('../../api/utils/db');

module.exports = {
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('listauths')
    .setDescription('List all authorized users')
    .addIntegerOption(opt =>
      opt.setName('page')
        .setDescription('Page number (default: 1)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const page = interaction.options.getInteger('page') || 1;
    const perPage = 10;

    const db = await connectDB();
    const collection = db.collection('authorized_users');

    const total = await collection.countDocuments();
    const users = await collection
      .find({})
      .sort({ authorizedAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .toArray();

    if (users.length === 0) {
      return interaction.editReply('📭 No authorized users found.');
    }

    const userList = users.map((u, i) => {
      const index = (page - 1) * perPage + i + 1;
      const date = new Date(u.authorizedAt).toLocaleDateString();
      return `\`${index}.\` **${u.globalName || u.username}** (\`${u.userId}\`) — ${date}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🔐 Authorized Users — Page ${page}`)
      .setDescription(userList)
      .setColor(0x57f287)
      .setFooter({ text: `Total: ${total} users | Page ${page} of ${Math.ceil(total / perPage)}` });

    await interaction.editReply({ embeds: [embed] });
  },
};