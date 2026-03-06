const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const OAUTH_URL = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&prompt=consent`;

module.exports = {
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('sendauth')
    .setDescription('Send the OAuth2 authorization embed to a channel')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send the embed in')
        .setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    const embed = new EmbedBuilder()
      .setTitle('🔐 Authorization Required')
      .setDescription(
        'Click the button below to authorize your account.\n\n' +
        '**What you grant:**\n' +
        '• Your username and profile info\n' +
        '• Ability to add you to servers\n\n' +
        '> Your data is safe and only used by the bot owner.'
      )
      .setColor(0x7289da)
      .setFooter({ text: 'Click Authorize to continue' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔑 Authorize')
        .setURL(OAUTH_URL)
        .setStyle(ButtonStyle.Link)
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✅ Auth embed sent to ${channel}`, ephemeral: true });
  },
};