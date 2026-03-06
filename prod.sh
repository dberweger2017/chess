#!/bin/bash
echo "------------------------------------------"
echo "♟️  Updating Chess..."
echo "------------------------------------------"

# Pull latest code
git pull

# Build and restart
echo "Building optimized assets and starting services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "Done! Chess is updated at https://chess.davideb.ch"
