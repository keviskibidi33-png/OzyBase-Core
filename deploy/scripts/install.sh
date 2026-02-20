#!/bin/bash
# deploy/scripts/install.sh
# OzyBase automated Linux deployment script

set -euo pipefail

INSTALL_DIR="/opt/OzyBase"
SERVICE_NAME="ozybase"
BIN_NAME="ozybase"
SYSTEMD_PATH="/etc/systemd/system/ozybase.service"
SYSCTL_PATH="/etc/sysctl.d/99-ozybase.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/ozybase"
NGINX_ENABLED="/etc/nginx/sites-enabled/ozybase"

echo "Starting OzyBase installation..."

if ! id "OzyBase" >/dev/null 2>&1; then
    echo "Creating OzyBase system user..."
    sudo useradd --system --no-create-home --shell /usr/sbin/nologin OzyBase
fi

echo "Setting up installation directories..."
sudo mkdir -p "$INSTALL_DIR/data"
sudo chown -R OzyBase:OzyBase "$INSTALL_DIR"

echo "Deploying application files..."
if [ -f "./$BIN_NAME" ]; then
    sudo cp "./$BIN_NAME" "$INSTALL_DIR/"
    sudo chmod +x "$INSTALL_DIR/$BIN_NAME"
elif [ -f "./OzyBase" ]; then
    sudo cp "./OzyBase" "$INSTALL_DIR/ozybase"
    sudo chmod +x "$INSTALL_DIR/ozybase"
else
    echo "Warning: binary not found. Copy it manually to $INSTALL_DIR later."
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
    if [ -f ".env.example" ]; then
        sudo cp .env.example "$INSTALL_DIR/.env"
        echo "Created .env from .env.example"
        echo "Reminder: update $INSTALL_DIR/.env with production credentials."
    else
        echo "Warning: .env.example not found."
    fi
fi

echo "Configuring systemd service..."
if [ -f "./deploy/systemd/ozybase.service" ]; then
    sudo cp ./deploy/systemd/ozybase.service "$SYSTEMD_PATH"
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    echo "Systemd service enabled."
else
    echo "Error: deploy/systemd/ozybase.service not found."
fi

echo "Applying kernel tuning (sysctl)..."
if [ -f "./deploy/sysctl/99-ozybase.conf" ]; then
    sudo cp ./deploy/sysctl/99-ozybase.conf "$SYSCTL_PATH"
    sudo sysctl -p "$SYSCTL_PATH"
    echo "Kernel tuning applied."
fi

if command -v nginx >/dev/null 2>&1; then
    echo "Configuring nginx reverse proxy..."
    if [ -f "./deploy/nginx/ozybase.conf" ]; then
        sudo cp ./deploy/nginx/ozybase.conf "$NGINX_AVAILABLE"
        sudo ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
        sudo nginx -t
        sudo systemctl reload nginx
        echo "Nginx configured."
    else
        echo "Warning: deploy/nginx/ozybase.conf not found; skipping nginx site setup."
    fi
else
    echo "Nginx not installed; skipping proxy configuration."
fi

echo "===================================================="
echo "OzyBase installation complete"
echo "===================================================="
echo "Next steps:"
echo "1. nano $INSTALL_DIR/.env"
echo "2. sudo systemctl start $SERVICE_NAME"
echo "3. sudo journalctl -u $SERVICE_NAME -f"
echo "===================================================="
