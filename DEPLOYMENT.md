# LobeChat VPS Deployment Guide

Complete guide to deploy LobeChat with PostgreSQL, Google OAuth, Vultr S3, and OpenRouter.

## Prerequisites

- VPS with Ubuntu 22.04+ (1GB RAM minimum, 2GB recommended)
- Domain pointed to VPS IP (A record)
- Google OAuth credentials (from Google Cloud Console)
- S3-compatible storage (Vultr Object Storage, AWS S3, etc.)
- LLM API key (OpenRouter, OpenAI, etc.)

---

## Step 1: Initial Server Setup

SSH into your VPS:

```bash
ssh root@YOUR_VPS_IP
```

Update system:

```bash
apt update && apt upgrade -y
```

## Step 2: Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

Verify installation:

```bash
docker --version
docker compose version
```

## Step 3: Open Firewall Ports

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw reload
```

## Step 4: Create Deployment Directory

```bash
mkdir -p ~/lobe-chat && cd ~/lobe-chat
```

## Step 5: Generate Secrets

Generate secure secrets for your deployment:

```bash
# Generate NEXT_AUTH_SECRET (48 bytes, base64)
echo "NEXT_AUTH_SECRET: $(openssl rand -base64 48)"

# Generate KEY_VAULTS_SECRET (32 bytes, base64)
echo "KEY_VAULTS_SECRET: $(openssl rand -base64 32)"

# Generate POSTGRES_PASSWORD
echo "POSTGRES_PASSWORD: $(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)"
```

Save these values - you'll need them for the .env file.

## Step 6: Create Environment File

```bash
cat > .env << 'EOF'
# App
LOBE_PORT=3210
APP_URL=https://YOUR_DOMAIN
NEXTAUTH_URL=https://YOUR_DOMAIN/api/auth

# Secrets (replace with generated values)
NEXT_AUTH_SECRET=YOUR_GENERATED_SECRET
KEY_VAULTS_SECRET=YOUR_GENERATED_SECRET

# Database
LOBE_DB_NAME=lobe_chat
POSTGRES_PASSWORD=YOUR_GENERATED_PASSWORD

# Google OAuth
AUTH_GOOGLE_ID=YOUR_GOOGLE_CLIENT_ID
AUTH_GOOGLE_SECRET=YOUR_GOOGLE_CLIENT_SECRET

# S3 Storage
S3_ENDPOINT=https://YOUR_S3_ENDPOINT
S3_BUCKET=YOUR_BUCKET_NAME
S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
S3_PUBLIC_DOMAIN=https://YOUR_BUCKET_PUBLIC_URL

# LLM Provider (OpenRouter example)
OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
OPENROUTER_MODEL_LIST=-all,+google/gemini-2.5-flash,+openai/gpt-4o-mini

# Optional: Custom Branding
NEXT_PUBLIC_CUSTOM_BRAND=MyBrand
NEXT_PUBLIC_LOGO_URL=/favicon.png
EOF
```

Edit with your actual values:

```bash
nano .env
```

## Step 7: Create Docker Compose File

```bash
cat > docker-compose.yml << 'EOF'
name: lobe-chat

services:
  postgresql:
    image: pgvector/pgvector:pg17
    container_name: lobe-postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=${LOBE_DB_NAME}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always
    networks:
      - lobe-network

  lobe:
    image: lobehub/lobe-chat-database
    container_name: lobe-chat
    ports:
      - '${LOBE_PORT}:3210'
    depends_on:
      postgresql:
        condition: service_healthy
    environment:
      - APP_URL=${APP_URL}
      - NEXTAUTH_URL=${NEXTAUTH_URL}
      - NEXT_AUTH_SECRET=${NEXT_AUTH_SECRET}
      - KEY_VAULTS_SECRET=${KEY_VAULTS_SECRET}
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgresql:5432/${LOBE_DB_NAME}
      - NEXT_AUTH_SSO_PROVIDERS=google
      - AUTH_GOOGLE_ID=${AUTH_GOOGLE_ID}
      - AUTH_GOOGLE_SECRET=${AUTH_GOOGLE_SECRET}
      - S3_ENDPOINT=${S3_ENDPOINT}
      - S3_BUCKET=${S3_BUCKET}
      - S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
      - S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
      - S3_PUBLIC_DOMAIN=${S3_PUBLIC_DOMAIN}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - OPENROUTER_MODEL_LIST=${OPENROUTER_MODEL_LIST}
      - NEXT_PUBLIC_CUSTOM_BRAND=${NEXT_PUBLIC_CUSTOM_BRAND}
      - NEXT_PUBLIC_LOGO_URL=${NEXT_PUBLIC_LOGO_URL}
    restart: always
    networks:
      - lobe-network

volumes:
  postgres_data:
    driver: local

networks:
  lobe-network:
    driver: bridge
EOF
```

## Step 8: Start Services

```bash
docker compose up -d
```

Check status:

```bash
docker compose ps
docker compose logs lobe --tail 50
```

## Step 9: Install Nginx

```bash
apt install -y nginx
```

## Step 10: Configure Nginx

```bash
cat > /etc/nginx/sites-available/YOUR_DOMAIN << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
EOF
```

Replace YOUR_DOMAIN and enable:

```bash
ln -sf /etc/nginx/sites-available/YOUR_DOMAIN /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## Step 11: Get SSL Certificate

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d YOUR_DOMAIN
```

## Step 12: Add Brute Force Protection (Optional)

### Add rate limiting to Nginx

Edit `/etc/nginx/nginx.conf` and add inside the `http {` block:

```nginx
http {
    # Rate limiting zones
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=api:10m rate=5r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=1r/s;
    limit_conn_zone $binary_remote_addr zone=addr:10m;

    # ... rest of config
}
```

Update your site config:

```bash
cat > /etc/nginx/sites-available/YOUR_DOMAIN << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name YOUR_DOMAIN;

    ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    client_max_body_size 50M;
    client_body_timeout 10s;
    client_header_timeout 10s;

    # Connection limits
    limit_conn addr 20;
    limit_conn_status 429;

    # General rate limit
    limit_req zone=general burst=20 nodelay;
    limit_req_status 429;

    # Auth endpoints - strict (1 req/s)
    location /api/auth/ {
        limit_req zone=auth burst=3 nodelay;
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API endpoints - moderate (5 req/s)
    location /api/ {
        limit_req zone=api burst=10 nodelay;
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    # Everything else
    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
EOF

nginx -t && systemctl reload nginx
```

### Install fail2ban

```bash
apt install -y fail2ban

# Create filter
cat > /etc/fail2ban/filter.d/nginx-auth.conf << 'EOF'
[Definition]
failregex = ^<HOST> .* "(GET|POST) /api/auth/.* HTTP.*" (401|403|429)
            limiting requests, excess:.* by zone.*client: <HOST>
ignoreregex =
EOF

# Create jail
cat > /etc/fail2ban/jail.d/nginx-auth.conf << 'EOF'
[nginx-auth]
enabled = true
filter = nginx-auth
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 5
findtime = 300
bantime = 3600

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 10
findtime = 60
bantime = 7200
EOF

systemctl restart fail2ban
systemctl enable fail2ban
```

---

## Database Backup & Restore

### Export Database

```bash
# Full database dump
docker exec lobe-postgres pg_dump -U postgres lobe_chat > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup
docker exec lobe-postgres pg_dump -U postgres lobe_chat | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Import Database

```bash
# Stop the lobe container first
docker compose stop lobe

# Import from SQL file
docker exec -i lobe-postgres psql -U postgres lobe_chat < backup_file.sql

# Import from compressed file
gunzip -c backup_file.sql.gz | docker exec -i lobe-postgres psql -U postgres lobe_chat

# Start lobe again
docker compose start lobe
```

### Automated Daily Backups

Create backup script:

```bash
cat > ~/lobe-chat/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=~/lobe-chat/backups
mkdir -p $BACKUP_DIR

# Create backup
docker exec lobe-postgres pg_dump -U postgres lobe_chat | gzip > $BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $(date)"
EOF

chmod +x ~/lobe-chat/backup.sh
```

Add to crontab (daily at 3 AM):

```bash
crontab -e
# Add this line:
0 3 * * * /root/lobe-chat/backup.sh >> /root/lobe-chat/backup.log 2>&1
```

### Transfer Backup to Local Machine

```bash
# From your local machine
scp root@YOUR_VPS_IP:~/lobe-chat/backups/backup_YYYYMMDD_HHMMSS.sql.gz ./
```

### Migrate to New Server

On old server:
```bash
docker exec lobe-postgres pg_dump -U postgres lobe_chat | gzip > migration_backup.sql.gz
```

Transfer to new server:
```bash
scp migration_backup.sql.gz root@NEW_VPS_IP:~/lobe-chat/
```

On new server (after docker compose up -d):
```bash
docker compose stop lobe
gunzip -c migration_backup.sql.gz | docker exec -i lobe-postgres psql -U postgres lobe_chat
docker compose start lobe
```

---

## Useful Commands

### View Logs

```bash
# All services
docker compose logs -f

# Just LobeChat
docker compose logs lobe -f --tail 100

# Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Restart Services

```bash
# All services
docker compose restart

# Just LobeChat
docker compose restart lobe

# Nginx
systemctl restart nginx
```

### Update LobeChat

```bash
cd ~/lobe-chat
docker compose pull
docker compose up -d
```

### Check fail2ban Status

```bash
fail2ban-client status
fail2ban-client status nginx-auth

# Unban an IP
fail2ban-client set nginx-auth unbanip IP_ADDRESS
```

### Check Disk Usage

```bash
# Docker volumes
docker system df

# Database size
docker exec lobe-postgres psql -U postgres -c "SELECT pg_size_pretty(pg_database_size('lobe_chat'));"
```

---

## Post-Reboot Health Checks

### Quick Manual Check

```bash
# Run all checks at once
echo "=== Docker ===" && docker compose ps && \
echo "=== Ports ===" && ss -tlnp | grep -E '(3210|443|80)' && \
echo "=== Nginx ===" && systemctl is-active nginx && \
echo "=== App ===" && curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/chat && \
echo "=== DB ===" && docker exec lobe-postgres pg_isready -U postgres
```

Expected output:
- All containers: `Up`
- Ports 80, 443, 3210: `LISTEN`
- Nginx: `active`
- App: `200`
- DB: `accepting connections`

### Automated Health Check Script

```bash
cat > ~/lobe-chat/healthcheck.sh << 'EOF'
#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0

check() {
    if [ $2 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "=== LobeChat Health Check ==="
echo "Time: $(date)"
echo ""

# Docker daemon
systemctl is-active --quiet docker
check "Docker daemon" $?

# PostgreSQL container
docker ps --format '{{.Names}}' | grep -q lobe-postgres
check "PostgreSQL container" $?

# PostgreSQL accepting connections
docker exec lobe-postgres pg_isready -U postgres > /dev/null 2>&1
check "PostgreSQL connections" $?

# LobeChat container
docker ps --format '{{.Names}}' | grep -q lobe-chat
check "LobeChat container" $?

# LobeChat responding
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/chat 2>/dev/null)
[ "$HTTP_CODE" = "200" ]
check "LobeChat HTTP (got $HTTP_CODE)" $?

# Nginx
systemctl is-active --quiet nginx
check "Nginx" $?

# SSL endpoint
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://localhost/chat --insecure 2>/dev/null)
[ "$HTTPS_CODE" = "200" ]
check "HTTPS endpoint (got $HTTPS_CODE)" $?

# Disk space (warn if >90%)
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
[ "$DISK_USAGE" -lt 90 ]
check "Disk space (${DISK_USAGE}% used)" $?

# Memory (warn if >90%)
MEM_USAGE=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
[ "$MEM_USAGE" -lt 90 ]
check "Memory (${MEM_USAGE}% used)" $?

echo ""
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC}"
    exit 0
else
    echo -e "${RED}$ERRORS check(s) failed!${NC}"
    exit 1
fi
EOF

chmod +x ~/lobe-chat/healthcheck.sh
```

Run it:
```bash
~/lobe-chat/healthcheck.sh
```

### Run Health Check on Boot

Create systemd service:

```bash
cat > /etc/systemd/system/lobe-healthcheck.service << 'EOF'
[Unit]
Description=LobeChat Health Check
After=docker.service nginx.service
Wants=docker.service

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 60
ExecStart=/root/lobe-chat/healthcheck.sh
StandardOutput=append:/root/lobe-chat/healthcheck.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lobe-healthcheck.service
```

### Periodic Health Monitoring (Every 5 Minutes)

```bash
crontab -e
# Add this line:
*/5 * * * * /root/lobe-chat/healthcheck.sh >> /root/lobe-chat/healthcheck.log 2>&1 || echo "LobeChat health check failed at $(date)" >> /root/lobe-chat/alerts.log
```

### Auto-Restart on Failure

Docker Compose already has `restart: always`, but add a watchdog:

```bash
cat > ~/lobe-chat/watchdog.sh << 'EOF'
#!/bin/bash

# Check if app responds
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/chat 2>/dev/null)

if [ "$HTTP_CODE" != "200" ]; then
    echo "$(date): LobeChat not responding (HTTP $HTTP_CODE), restarting..." >> ~/lobe-chat/watchdog.log
    cd ~/lobe-chat && docker compose restart lobe
    sleep 30

    # Check again
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/chat 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "$(date): LobeChat recovered" >> ~/lobe-chat/watchdog.log
    else
        echo "$(date): LobeChat still down after restart!" >> ~/lobe-chat/watchdog.log
    fi
fi
EOF

chmod +x ~/lobe-chat/watchdog.sh

# Run every 2 minutes
crontab -e
# Add:
*/2 * * * * /root/lobe-chat/watchdog.sh
```

### Verify After Reboot

After rebooting the server:

```bash
# 1. Check all services started
~/lobe-chat/healthcheck.sh

# 2. If something is down, check logs
docker compose logs --tail 50
journalctl -u nginx --since "10 minutes ago"

# 3. Manual restart if needed
cd ~/lobe-chat && docker compose up -d
systemctl restart nginx
```

### Test Reboot Recovery

```bash
# Simulate reboot
sudo reboot

# After reconnecting (wait ~1 min)
~/lobe-chat/healthcheck.sh
```

---

## Troubleshooting

### Site not loading

1. Check containers: `docker compose ps`
2. Check logs: `docker compose logs lobe --tail 50`
3. Test locally: `curl -I http://localhost:3210`
4. Check nginx: `nginx -t && systemctl status nginx`
5. Check firewall: `ufw status`

### Database connection error

1. Check postgres: `docker compose logs postgresql`
2. Verify DATABASE_URL in .env matches credentials
3. Check postgres health: `docker exec lobe-postgres pg_isready`

### SSL certificate issues

1. Check cert status: `certbot certificates`
2. Renew manually: `certbot renew --dry-run`
3. Check nginx config: `nginx -t`

### Out of memory

1. Check usage: `free -h`
2. Add swap:
   ```bash
   fallocate -l 2G /swapfile
   chmod 600 /swapfile
   mkswap /swapfile
   swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```
