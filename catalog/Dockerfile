
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY data/ ./data/

EXPOSE 8001

CMD ["npm", "start"]
