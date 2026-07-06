#!/usr/bin/env bash
# Richtet auf einem Raspberry Pi (Raspberry Pi OS, 64-bit) ein:
#  1. Mindustry-Multiplayer-Server (Port 6567) als Dauerdienst
#  2. Webseite mit Mindustry Classic im Browser (Port 80)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte mit sudo starten:  sudo bash install.sh"
    exit 1
fi

cd "$(dirname "$0")"

MINDUSTRY_VERSION="v158.1"

echo "==> Schritt 1/6: Java, nginx und Node.js installieren ..."
apt-get update
apt-get install -y default-jre-headless nginx curl nodejs npm

echo "==> Schritt 2/6: Mindustry-Server nach /opt/mindustry kopieren ..."
mkdir -p server
if [ ! -f server/server-release.jar ]; then
    echo "    Lade offiziellen Mindustry-Server $MINDUSTRY_VERSION von GitHub ..."
    curl -fL -o server/server-release.jar \
        "https://github.com/Anuken/Mindustry/releases/download/$MINDUSTRY_VERSION/server-release.jar"
fi
id -u mindustry >/dev/null 2>&1 || useradd -r -d /opt/mindustry -s /usr/sbin/nologin mindustry
mkdir -p /opt/mindustry
cp server/server-release.jar /opt/mindustry/
chown -R mindustry:mindustry /opt/mindustry

echo "==> Schritt 3/6: Pindustry (Browser-Koop) nach /opt/pindustry kopieren ..."
mkdir -p /opt/pindustry
cp pindustry/server.js pindustry/package.json /opt/pindustry/
(cd /opt/pindustry && npm install --omit=dev --no-audit --no-fund)
chown -R mindustry:mindustry /opt/pindustry

echo "==> Schritt 4/6: Webseite nach /var/www/mindustry kopieren ..."
mkdir -p /var/www/mindustry
cp -r web/. /var/www/mindustry/
mkdir -p /var/www/mindustry/pindustry
cp -r pindustry/public/. /var/www/mindustry/pindustry/
chown -R www-data:www-data /var/www/mindustry

echo "==> Schritt 5/6: nginx einrichten ..."
cp nginx-mindustry.conf /etc/nginx/sites-available/mindustry
ln -sf /etc/nginx/sites-available/mindustry /etc/nginx/sites-enabled/mindustry
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "==> Schritt 6/6: Spiel-Server als Dienste starten ..."
cp systemd/mindustry-server.service /etc/systemd/system/
cp systemd/pindustry.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mindustry-server
systemctl enable --now pindustry
systemctl restart pindustry

IP=$(hostname -I | awk '{print $1}')
echo
echo "================================================================"
echo " Fertig!"
echo
echo " Webseite (Browser, z. B. Safari):   http://$IP"
echo " Multiplayer-Server (im Spiel):      $IP:6567"
echo
echo " Server-Status ansehen:   sudo systemctl status mindustry-server"
echo " Server-Log live:         sudo journalctl -u mindustry-server -f"
echo "================================================================"
