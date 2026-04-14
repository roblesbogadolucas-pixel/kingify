FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY *.js ./
COPY erp/ ./erp/
COPY memory/ ./memory/
COPY data/ ./data/

CMD ["node", "index.js"]
