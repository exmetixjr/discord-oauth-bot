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
