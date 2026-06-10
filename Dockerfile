FROM node:20-slim

# Install dependencies for native modules (needed by some Baileys deps)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY index.mjs ./

# Railway injects PORT automatically — do not hardcode it
EXPOSE 3000

CMD ["node", "index.mjs"]
