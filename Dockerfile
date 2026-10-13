FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY bots ./bots
COPY assets ./assets

CMD ["node", "--max-old-space-size=64", "--max-semi-space-size=1", "bots/container.js"]
