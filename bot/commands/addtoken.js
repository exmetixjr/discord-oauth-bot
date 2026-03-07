const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { connectDB } = require('../../api/utils/db');
const { log } = require('../utils/audit');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function saveUser(user, accessToken) {
  const db = await connectDB();
  await db.collection('authorized_users').updateOne({ userId: user.id },
    { $set: { userId:user.id, username:user.username, globalName:user.global_name||user.username, avatar:user.avatar, accessToken, authorizedAt:new Date(), tokenExpires:new Date(Date.now()+7*24*60*60*1000) }, $setOnInsert:{ firstAuthorizedAt:new Date() } },
    { upsert:true }
  );
}

module.exports = {
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('addtoken')
    .setDescription('Manually import users via their OAuth access token')
    .addSubcommand(sub => sub.setName('single').setDescription('Add one token')
      .addStringOption(opt => opt.setName('token').setDescription('OAuth access token').setRequired(true)))
    .addSubcommand(sub => sub.setName('multi').setDescription('Add multiple tokens via text or .txt file')
      .addStringOption(opt => opt.setName('tokens').setDescription('Comma-separated tokens').setRequired(false))
      .addAttachmentOption(opt => opt.setName('file').setDescription('.txt file — one token per line').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let tokens = [];

    if (sub === 'single') tokens = [interaction.options.getString('token').trim()];
    if (sub === 'multi') {
      const raw = interaction.options.getString('tokens');
      if (raw) tokens = raw.split(',').map(t => t.trim()).filter(Boolean);
      const att = interaction.options.getAttachment('file');
      if (att) {
        if (!att.name.endsWith('.txt')) return interaction.editReply('❌ File must be .txt');
        const text = await (await fetch(att.url)).text();
        tokens = [...new Set([...tokens, ...text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean)])];
      }
    }

    if (tokens.length === 0) return interaction.editReply('❌ No tokens provided.');
    await interaction.editReply(`⏳ Processing **${tokens.length}** token(s)...`);

    let success=0, failed=0; const errors=[];
    for (const token of tokens) {
      try {
        const res = await fetch('https://discord.com/api/users/@me', { headers:{ Authorization:`Bearer ${token}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const user = await res.json();
        if (!user.id) throw new Error('No user ID returned');
        await saveUser(user, token);
        success++;
        console.log(`✅ Token imported for ${user.username} (${user.id})`);
      } catch(err) {
        failed++;
        errors.push(`\`${token.slice(0,15)}...\` → ${err.message}`);
      }
      await sleep(300);
    }

    await log('addtoken', interaction.user.id, { total:tokens.length, success, failed });
    const embed = new EmbedBuilder().setTitle('🔑 Token Import Complete').setColor(success>0?0x57f287:0xed4245)
      .addFields({ name:'✅ Imported',value:`${success}`,inline:true },{ name:'❌ Failed',value:`${failed}`,inline:true });
    if (errors.length) embed.addFields({ name:'⚠️ Errors',value:errors.slice(0,10).join('\n') });
    await interaction.editReply({ content:'', embeds:[embed] });
  },
};
