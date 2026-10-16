# syntax=docker/dockerfile:1
# Build context is this directory (smartops/TWise.Frontend.Tenant/):
#   docker build -t twise/frontend .

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER root
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/35-twise-upstreams.sh /docker-entrypoint.d/35-twise-upstreams.sh
COPY docker/40-twise-runtime-env.sh /docker-entrypoint.d/40-twise-runtime-env.sh
COPY --from=build /src/dist/t-wise-dashboard-ui/browser/ /usr/share/nginx/html/
RUN chmod +x /docker-entrypoint.d/35-twise-upstreams.sh /docker-entrypoint.d/40-twise-runtime-env.sh \
 && chown -R 101:101 /usr/share/nginx/html /etc/nginx/conf.d
USER 101
EXPOSE 8080
