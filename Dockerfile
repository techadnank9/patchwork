# Patchwork: Node app + Semgrep CLI + git + python3 for syntax checks. No build step.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages semgrep \
  && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.mjs"]
