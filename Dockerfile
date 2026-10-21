# Multi-stage or single lean build for Google Cloud Run
FROM node:22-alpine

WORKDIR /app

# Copy root and client package definitions and local SDK tarballs
COPY package*.json ./
COPY client/package*.json ./client/
COPY client/k-id-core-web.tgz ./client/

# Install dependencies
RUN npm install
RUN npm --prefix client install

# Copy application source code
COPY . .

# Build the React frontend into client/dist
RUN npm run build

# Cloud Run sets PORT environment variable (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Start Express server (serves both API & built client)
CMD ["node", "server.js"]

