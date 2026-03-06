#!/bin/bash
echo "Starting Chess application in PRODUCTION mode..."
echo "Building optimized assets and starting services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
echo "Done! Application is running at chess.davideb.ch"
