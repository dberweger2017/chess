# Stage 1: Build dependencies
FROM node:20-alpine as base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build the React application
FROM base as builder
COPY . .
RUN npm run build

# Stage 3: Serve with Caddy
FROM caddy:alpine

# Copy built files
COPY --from=builder /app/dist /srv

# Copy Caddy configuration
COPY Caddyfile /etc/caddy/Caddyfile

# Expose HTTP and HTTPS ports
EXPOSE 80
EXPOSE 443

# Start Caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
