const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { connectDB } = require('../../api/utils/db');
const { log } = require('../utils/audit');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function addMember(guildId, userId, accessToken, botToken) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken }),
  });
  return res.status;
}

module.exports = {
  restricted: true,
  data: new SlashCommandBuilder()
    .setName('joinuser')
    .setDescription('Force-join authorized users to this server')
    .addSubcommand(sub => sub.setName('one').setDescription('Join a single user')
      .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('selected').setDescription('Join multiple users by ID or .txt file')
      .addStringOption(opt => opt.setName('userids').setDescription('Comma-separated user IDs').setRequired(false))
      .addAttachmentOption(opt => opt.setName('file').setDescription('.txt file with one user ID per line').setRequired(false)))
    .addSubcommand(sub => sub.setName('all').setDescription('Join ALL authorized users')
      .addBooleanOption(opt => opt.setName('confirm').setDescription('Must be true').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    await interaction.deferReply({ flags: 64 });
    const db = await connectDB();
    const col = db.collection('authorized_users');

    if (sub === 'one') {
      const userId = interaction.options.getString('userid').trim();
      const user = await col.findOne({ userId });
      if (!user) return interaction.editReply(`❌ User \`${userId}\` has not authorized the bot.`);
      const status = await addMember(guildId, userId, user.accessToken, process.env.BOT_TOKEN);
      await log('joinuser_one', interaction.user.id, { userId, guildId, status });
      if (status === 201) return interaction.editReply(`✅ Added **${user.globalName||user.username}**!`);
      if (status === 204) return interaction.editReply(`ℹ️ **${user.globalName||user.username}** is already in this server.`);
      return interaction.editReply(`❌ Failed. Discord returned \`${status}\`. Token may be expired.`);
    }

    if (sub === 'selected') {
      let userIds = [];
      const rawIds = interaction.options.getString('userids');
      if (rawIds) userIds = rawIds.split(',').map(id => id.trim()).filter(id => /^\d{17,20}$/.test(id));
      const attachment = interaction.options.getAttachment('file');
      if (attachment) {
        if (!attachment.name.endsWith('.txt')) return interaction.editReply('❌ File must be a .txt file.');
        const res = await fetch(attachment.url);
        const text = await res.text();
        const fileIds = text.split(/\r?\n/).map(id => id.trim()).filter(id => /^\d{17,20}$/.test(id));
        userIds = [...new Set([...userIds, ...fileIds])];
      }
      if (userIds.length === 0) return interaction.editReply('❌ No valid user IDs provided.');
      await interaction.editReply(`⏳ Processing **${userIds.length}** users...`);
      let added=0, already=0, notFound=0, failed=0; const errors=[];
      for (const userId of userIds) {
        const user = await col.findOne({ userId });
        if (!user) { notFound++; continue; }
        const status = await addMember(guildId, userId, user.accessToken, process.env.BOT_TOKEN);
        if (status===201) added++;
        else if (status===204) already++;
        else { failed++; errors.push(`\`${userId}\` → HTTP ${status}`); }
        await sleep(600);
      }
      await log('joinuser_selected', interaction.user.id, { guildId, added, already, notFound, failed });
      const embed = new EmbedBuilder().setTitle('✅ Selected Join Complete').setColor(0x57f287)
        .addFields({ name:'➕ Added',value:`${added}`,inline:true },{ name:'🔁 Already in',value:`${already}`,inline:true },{ name:'❓ Not authorized',value:`${notFound}`,inline:true },{ name:'❌ Failed',value:`${failed}`,inline:true });
      if (errors.length) embed.addFields({ name:'⚠️ Errors', value:errors.slice(0,10).join('\n') });
      return interaction.editReply({ content:'', embeds:[embed] });
    }

    if (sub === 'all') {
      if (!interaction.options.getBoolean('confirm')) return interaction.editReply('❌ Set confirm to True.');
      const total = await col.countDocuments();
      if (total === 0) return interaction.editReply('📭 No authorized users.');
      await interaction.editReply(`⏳ Joining **${total}** users...`);
      const users = await col.find({}).toArray();
      let added=0,already=0,failed=0;
      for (const user of users) {
        const status = await addMember(guildId, user.userId, user.accessToken, process.env.BOT_TOKEN);
        if (status===201) added++; else if (status===204) already++; else failed++;
        await sleep(600);
      }
      await log('joinuser_all', interaction.user.id, { guildId, added, already, failed });
      const embed = new EmbedBuilder().setTitle('✅ Join All Complete').setColor(0x57f287)
        .addFields({ name:'➕ Added',value:`${added}`,inline:true },{ name:'🔁 Already in',value:`${already}`,inline:true },{ name:'❌ Failed',value:`${failed}`,inline:true });
      return interaction.editReply({ content:'', embeds:[embed] });
    }
  },
};
