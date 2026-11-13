
FROM node:22-bookworm-slim

WORKDIR /app

# Tools needed to compile better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 8004

CMD ["npm", "start"]
