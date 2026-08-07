FROM node:22.22.0-alpine3.23@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --global npm@11.9.0 \
    && test "$(npm --version)" = "11.9.0" \
    && npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_APP_PUBLIC_URL
ARG VITE_MCP_SERVER_URL=""
ARG VITE_MCP_OAUTH_METADATA_URL=""
ARG VITE_WEBHOOK_URL=""
ARG VITE_SUPPORT_WHATSAPP_NUMBER=""

RUN test -n "$VITE_SUPABASE_URL" \
    && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" \
    && test -n "$VITE_APP_PUBLIC_URL" \
    && VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
       VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
       VITE_APP_PUBLIC_URL="$VITE_APP_PUBLIC_URL" \
       VITE_MCP_SERVER_URL="$VITE_MCP_SERVER_URL" \
       VITE_MCP_OAUTH_METADATA_URL="$VITE_MCP_OAUTH_METADATA_URL" \
       VITE_WEBHOOK_URL="$VITE_WEBHOOK_URL" \
       VITE_SUPPORT_WHATSAPP_NUMBER="$VITE_SUPPORT_WHATSAPP_NUMBER" \
       npm run build

FROM nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46 AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:8080/healthz || exit 1
