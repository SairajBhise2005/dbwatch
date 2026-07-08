# DBWatch backend — production image
FROM node:22-alpine

# postgresql-client gives us pg_dump / pg_restore for the backup
# feature (Stage 4). Installing now so the image is ready.
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

# Backups live here; mounted as a volume in docker-compose.
RUN mkdir -p /app/backups

EXPOSE 3001
CMD ["node", "server.js"]
