const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { connectDB } = require('../../api/utils/db');
const { listPermissions, grantPermission, revokePermission } = require('../utils/permissions');
const { log } = require('../utils/audit');

module.exports = {
  restricted: true,
  data: new SlashCommandBuilder()
    .setName('listauths')
    .setDescription('List authorized users or manage permissions')
    .addSubcommand(sub => sub.setName('users').setDescription('List all authorized users')
      .addIntegerOption(opt => opt.setName('page').setDescription('Page number').setRequired(false))
      .addStringOption(opt => opt.setName('filter').setDescription('Filter by token status').setRequired(false)
        .addChoices({ name: 'All', value: 'all' }, { name: 'Valid tokens', value: 'valid' }, { name: 'Expired tokens', value: 'expired' }))
    )
    .addSubcommand(sub => sub.setName('grant').setDescription('[Owner] Grant permissions to a user')
      .addUserOption(opt => opt.setName('user').setDescription('User to grant').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('revoke').setDescription('[Owner] Revoke permissions from a user')
      .addUserOption(opt => opt.setName('user').setDescription('User to revoke').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('permissions').setDescription('[Owner] List all users with granted permissions')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (['grant','revoke','permissions'].includes(sub) && interaction.user.id !== process.env.BOT_OWNER_ID) {
      return interaction.reply({ content: '❌ Only the bot owner can manage permissions.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: 64 });

    if (sub === 'grant') {
      const target = interaction.options.getUser('user');
      await grantPermission(target.id, interaction.user.id);
      await log('grant_permission', interaction.user.id, { targetId: target.id });
      return interaction.editReply(`✅ Granted access to **${target.username}** (\`${target.id}\`).`);
    }
    if (sub === 'revoke') {
      const target = interaction.options.getUser('user');
      if (target.id === process.env.BOT_OWNER_ID) return interaction.editReply('❌ Cannot revoke owner.');
      await revokePermission(target.id);
      await log('revoke_permission', interaction.user.id, { targetId: target.id });
      return interaction.editReply(`✅ Revoked permissions from **${target.username}**.`);
    }
    if (sub === 'permissions') {
      const perms = await listPermissions();
      if (perms.length === 0) return interaction.editReply('📭 No permissions granted yet.');
      const list = perms.map(p => `<@${p.userId}> — granted by <@${p.grantedBy}> <t:${Math.floor(new Date(p.grantedAt).getTime()/1000)}:R>`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔐 Granted Permissions').setDescription(list).setColor(0x7289da)] });
    }

    const page = interaction.options.getInteger('page') || 1;
    const filter = interaction.options.getString('filter') || 'all';
    const perPage = 10;
    const db = await connectDB();
    let query = {};
    if (filter === 'valid') query.tokenExpires = { $gt: new Date() };
    if (filter === 'expired') query.tokenExpires = { $lt: new Date() };
    const total = await db.collection('authorized_users').countDocuments(query);
    const users = await db.collection('authorized_users').find(query).sort({ authorizedAt: -1 }).skip((page-1)*perPage).limit(perPage).toArray();
    if (users.length === 0) return interaction.editReply('📭 No users found.');
    const list = users.map((u,i) => {
      const idx = (page-1)*perPage+i+1;
      const s = new Date(u.tokenExpires) > new Date() ? '🟢' : '🔴';
      return `\`${idx}.\` ${s} **${u.globalName||u.username}** (\`${u.userId}\`) — <t:${Math.floor(new Date(u.authorizedAt).getTime()/1000)}:R>`;
    }).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🔐 Authorized Users`).setDescription(list).setColor(0x57f287).setFooter({ text: `Total: ${total} | Page ${page}/${Math.ceil(total/perPage)} | 🟢 Valid  🔴 Expired` })] });
  },
};
