FROM node:18-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && i=0; until [ "$i" -ge 5 ]; do npm ci --omit=dev && break; i=$((i+1)); echo "npm ci failed, retry $i/5"; sleep 10; done; [ "$i" -lt 5 ]

COPY . .

EXPOSE 5000

CMD ["npm", "start"]
