# Build stage
FROM node:18-alpine AS build
WORKDIR /app

COPY package*.json ./
# Use legacy peer deps to avoid TypeScript peer conflict during CI builds
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && i=0; until [ "$i" -ge 5 ]; do npm ci --legacy-peer-deps && break; i=$((i+1)); echo "npm ci failed, retry $i/5"; sleep 10; done; [ "$i" -lt 5 ]

COPY . .

ARG REACT_APP_API_BASE_URL=http://localhost:5000
ARG REACT_APP_LEGAL_RAG_API=https://legal-rag-assistant-742042368490.asia-south1.run.app
ARG REACT_APP_CHAT_HISTORY_API=http://localhost:4000
ARG REACT_APP_VOICE_SERVICE_URL=https://voice-interview-agent-e5zeguajta-uc.a.run.app
ENV REACT_APP_API_BASE_URL=${REACT_APP_API_BASE_URL}
ENV REACT_APP_LEGAL_RAG_API=${REACT_APP_LEGAL_RAG_API}
ENV REACT_APP_CHAT_HISTORY_API=${REACT_APP_CHAT_HISTORY_API}
ENV REACT_APP_VOICE_SERVICE_URL=${REACT_APP_VOICE_SERVICE_URL}

# Build the production bundle
RUN npm run build

# Runtime stage
FROM nginx:alpine AS runtime

# Copy custom nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
