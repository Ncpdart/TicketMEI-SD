FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts=false

COPY index.js ./
COPY data/ ./data/

EXPOSE 8003

CMD ["node", "index.js"]
