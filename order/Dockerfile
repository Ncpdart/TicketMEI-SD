
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./

EXPOSE 8002

CMD ["npm", "start"]
