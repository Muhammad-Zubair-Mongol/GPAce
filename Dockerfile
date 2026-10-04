FROM node:22-bookworm-slim

# Pandoc is part of the API image, so Cloud Run needs no host installation.
RUN apt-get update \
    && apt-get install -y --no-install-recommends pandoc \
    && rm -rf /var/lib/apt/lists/* \
    && pandoc --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js ./
COPY server ./server
RUN mkdir -p data uploads && chown -R node:node /app

USER node
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
