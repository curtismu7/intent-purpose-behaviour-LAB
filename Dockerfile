# Build the web app, then run the API server, which also serves web/dist. Same pattern as the other demos.
# Node 26 only (rulebook). No Node 26 image was cached locally, so node:26-alpine is pulled on the first build.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7100 IPB_LAB_MODE=mock
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY server/diagrams server/diagrams
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 7100
# Inside the container the server must listen on all interfaces, so IPBLAB_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV IPBLAB_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
