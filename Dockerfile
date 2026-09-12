# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# 静态前端：nginx 直接托管构建产物，不依赖任何外部在线服务。
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# 一次性验收：运行单元测试与完整构建，结束后退出。
FROM deps AS verify
COPY . .
CMD ["npm", "run", "verify"]
