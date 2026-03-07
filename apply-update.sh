#!/bin/bash
# Run this from ~/discord-oauth-bot in Termux
# chmod +x apply-update.sh && ./apply-update.sh

set -e
echo "🚀 Applying bot update..."

# Create utils folder
mkdir -p bot/utils

# ── permissions.js ─────────────────────────────────────────
cat > bot/utils/permissions.js << 'JSEOF'
const { connectDB } = require('../../api/utils/db');

async function hasPermission(userId) {
  if (userId === process.env.BOT_OWNER_ID) return true;
  const db = await connectDB();
  const grant = await db.collection('permissions').findOne({ userId });
  return !!grant;
}

async function grantPermission(userId, grantedBy) {
  const db = await connectDB();
  await db.collection('permissions').updateOne(
    { userId },
    { $set: { userId, grantedBy, grantedAt: new Date() } },
    { upsert: true }
  );
}

async function revokePermission(userId) {
  const db = await connectDB();
  await db.collection('permissions').deleteOne({ userId });
}

async function listPermissions() {
  const db = await connectDB();
  return db.collection('permissions').find({}).toArray();
}

module.exports = { hasPermission, grantPermission, revokePermission, listPermissions };
JSEOF

# ── audit.js ───────────────────────────────────────────────
cat > bot/utils/audit.js << 'JSEOF'
const { connectDB } = require('../../api/utils/db');

async function log(action, performedBy, details = {}) {
  try {
    const db = await connectDB();
    await db.collection('audit_logs').insertOne({ action, performedBy, details, timestamp: new Date() });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { log };
JSEOF

# ── index.js ───────────────────────────────────────────────
cat > bot/index.js << 'JSEOF'
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
JSEOF

# ── auth.js ────────────────────────────────────────────────
cat > bot/commands/auth.js << 'JSEOF'
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { log } = require('../utils/audit');

module.exports = {
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('sendauth')
    .setDescription('Send the OAuth2 authorization embed to a channel')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send in').setRequired(false)),

  async execute(interaction) {
    const OAUTH_URL = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&prompt=consent`;
    const rawChannel = interaction.options.getChannel('channel');
    const channelId = rawChannel ? rawChannel.id : interaction.channelId;
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel) return interaction.reply({ content: '❌ Channel not found.', flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder()
      .setTitle('🔐 Authorization Required')
      .setDescription('Click the button below to authorize your account.\n\n**What you grant:**\n• Your username and profile info\n• Ability to add you to servers\n\n> Your data is safe and only used by the bot owner.')
      .setColor(0x7289da).setFooter({ text: 'Click Authorize to continue' }).setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🔑 Authorize').setURL(OAUTH_URL).setStyle(ButtonStyle.Link)
    );

    await channel.send({ embeds: [embed], components: [row] });
    await log('sendauth', interaction.user.id, { channelId });
    await interaction.reply({ content: `✅ Auth embed sent to <#${channelId}>!`, flags: MessageFlags.Ephemeral });
  },
};
JSEOF

# ── userinfo.js ────────────────────────────────────────────
cat > bot/commands/userinfo.js << 'JSEOF'
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
JSEOF

# ── authcount.js ───────────────────────────────────────────
cat > bot/commands/authcount.js << 'JSEOF'
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
JSEOF

# ── listauths.js ───────────────────────────────────────────
cat > bot/commands/listauths.js << 'JSEOF'
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
JSEOF

# ── joinuser.js ────────────────────────────────────────────
cat > bot/commands/joinuser.js << 'JSEOF'
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
JSEOF

# ── addtoken.js ────────────────────────────────────────────
cat > bot/commands/addtoken.js << 'JSEOF'
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
JSEOF

# ── stats.js ───────────────────────────────────────────────
cat > bot/commands/stats.js << 'JSEOF'
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectDB } = require('../../api/utils/db');
const os = require('os');

module.exports = {
  restricted: true,
  data: new SlashCommandBuilder().setName('stats').setDescription('Show bot statistics'),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: 64 });
    const db = await connectDB();
    const totalAuthed = await db.collection('authorized_users').countDocuments();
    const validTokens = await db.collection('authorized_users').countDocuments({ tokenExpires:{ $gt:new Date() } });
    const totalLogs = await db.collection('audit_logs').countDocuments();
    const s = Math.floor(process.uptime());
    const uptime = `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`;
    const mem = (process.memoryUsage().heapUsed/1024/1024).toFixed(1);
    const embed = new EmbedBuilder().setTitle('📊 Bot Statistics').setColor(0x7289da).setThumbnail(client.user.displayAvatarURL())
      .addFields(
        { name:'🤖 Bot',value:`**${client.user.tag}**`,inline:true },
        { name:'🏓 Ping',value:`**${client.ws.ping}ms**`,inline:true },
        { name:'⏱️ Uptime',value:`**${uptime}**`,inline:true },
        { name:'🌐 Servers',value:`**${client.guilds.cache.size}**`,inline:true },
        { name:'👥 Total Authorized',value:`**${totalAuthed}**`,inline:true },
        { name:'🟢 Valid Tokens',value:`**${validTokens}**`,inline:true },
        { name:'📋 Audit Logs',value:`**${totalLogs}** entries`,inline:true },
        { name:'💾 Memory',value:`**${mem}MB**`,inline:true },
        { name:'⚙️ Node.js',value:`**${process.version}**`,inline:true },
      ).setTimestamp();
    await interaction.editReply({ embeds:[embed] });
  },
};
JSEOF

# ── deploy-commands.js ─────────────────────────────────────
cat > bot/deploy-commands.js << 'JSEOF'
require('dotenv').config({ path: '../.env' });
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
  console.log(`📌 Queued: /${command.data.name}`);
}
const rest = new REST({ version:'10' }).setToken(process.env.BOT_TOKEN);
(async () => {
  console.log(`\n🔄 Registering ${commands.length} commands...`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body:commands });
  console.log('✅ All commands registered!');
})();
JSEOF

# Remove old standalone joinall.js — now part of joinuser subcommands
rm -f bot/commands/joinall.js

echo ""
echo "✅ All files written!"
echo ""
echo "Next steps:"
echo "  git add . && git commit -m 'feat: major bot overhaul' && git push"
echo "  cd bot && node deploy-commands.js"
