FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8082
ENV HOST=0.0.0.0

EXPOSE 8082
VOLUME ["/app/data"]

CMD ["node", "server/server.js"]
