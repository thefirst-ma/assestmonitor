FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# 创建数据目录
RUN mkdir -p /app/data

EXPOSE 3001

# 默认启动 Web 服务器，可通过 CMD 覆盖启动 CLI
CMD ["node", "dist/server.js"]
