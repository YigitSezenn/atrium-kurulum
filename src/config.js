require("dotenv").config();

module.exports = {
  token: process.env.DISCORD_TOKEN || "",
  guildId: process.env.GUILD_ID || "1219048713209516062",
  ytdlpCookies: process.env.YTDLP_COOKIES || "",
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || "",
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
  spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:47821/callback",
  henrikApiKey: process.env.HENRIK_API_KEY || "",
  agentBusPort: Number(process.env.AGENT_BUS_PORT || 47831),
  agentStackToken: process.env.AGENT_STACK_TOKEN || "",
  agentKaynakToken: process.env.AGENT_KAYNAK_TOKEN || "",
  agentRehberToken: process.env.AGENT_REHBER_TOKEN || "",
};
