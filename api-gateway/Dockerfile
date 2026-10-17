FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./

EXPOSE 8000

CMD ["npm", "start"]