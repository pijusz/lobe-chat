#!/bin/bash
set -e

# LobeChat Deploy Script
# Syncs upstream, builds, and deploys to production

REGISTRY="ams.vultrcr.com/sxmmaster/lobechat-shared"
VPS_USER="root"
VPS_HOST="vultr"  # Assumes SSH config alias, or replace with IP

echo "=== Step 1: Fetch upstream changes ==="
git fetch upstream

echo "=== Step 2: Rebase on upstream/next ==="
git pull --rebase upstream next

echo "=== Step 3: Push to fork ==="
git push origin next --force-with-lease

echo "=== Step 4: Build Docker image (AMD64) ==="
docker build -f Dockerfile.nolint --platform linux/amd64 -t ${REGISTRY}:latest .

echo "=== Step 5: Push to Vultr registry ==="
docker push ${REGISTRY}:latest

echo "=== Step 6: Deploy on VPS ==="
ssh ${VPS_USER}@${VPS_HOST} "cd ~/lobe-chat && docker compose pull && docker compose up -d --force-recreate"

echo ""
echo "=== Deployment complete! ==="
echo "Check status: ssh ${VPS_USER}@${VPS_HOST} 'docker compose -f ~/lobe-chat/docker-compose.yml ps'"
