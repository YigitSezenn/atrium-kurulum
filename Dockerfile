FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY bots ./bots
COPY assets ./assets

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && mkdir -p /app/bin \
  && curl -fsSL -o /app/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  && chmod 755 /app/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

CMD ["node", "bots/container.js"]
