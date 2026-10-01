require("dotenv").config();

const retiredChatModels = {
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
};

function resolveChatModel(value) {
  const requested = String(value || "openai/gpt-oss-120b").trim();
  const replacement = retiredChatModels[requested];
  if (!replacement) return requested;
  console.error(`Sohbet modeli ${requested} kalktı. Yerine ${replacement} kullanılıyor. .env içindeki CHAT_MODEL satırını buna çevir.`);
  return replacement;
}

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
  agentBanToken: process.env.AGENT_BAN_TOKEN || "",
  chatApiKey: process.env.CHAT_API_KEY || "",
  chatApiBase: process.env.CHAT_API_BASE || "https://api.groq.com/openai/v1",
  chatModel: resolveChatModel(process.env.CHAT_MODEL),
  chatApiExpires: process.env.CHAT_API_EXPIRES || "2027-09-30",
};
