FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts=false

COPY index.js ./

EXPOSE 8003

CMD ["node", "index.js"]
