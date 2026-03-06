FROM node:18-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose the server port
EXPOSE 3001

# Start the server
CMD ["node", "index.js"]
