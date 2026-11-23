#!/usr/bin/env bash
# ==============================================================================
# Fandejo cPanel Plugin Installer
# Installs and registers Fandejo for cPanel & WHM (Jupiter theme)
# Author: Toondout (https://toondout.com)
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${CYAN}               Fandejo Database Workbench — cPanel Installer                 ${NC}"
echo -e "${CYAN}==============================================================================${NC}"

# 1. Root check
if [[ "${EUID}" -ne 0 ]]; then
    echo -e "${RED}[ERROR] This installer must be run as root.${NC}" >&2
    exit 1
fi

# 2. cPanel environment check
if [[ ! -d "/usr/local/cpanel" ]]; then
    echo -e "${RED}[ERROR] /usr/local/cpanel not found. Is this a cPanel server?${NC}" >&2
    exit 1
fi

DEST_DIR="/usr/local/cpanel/base/frontend/jupiter/fandejo"
echo -e "${YELLOW}[1/6] Deploying plugin files to ${DEST_DIR}...${NC}"
mkdir -p "${DEST_DIR}"

# Copy runtime files
cp -r "${REPO_ROOT}/src/"* "${DEST_DIR}/"
cp "${REPO_ROOT}/cpanel/dynamicui/fandejo.svg" "${DEST_DIR}/"

# Set strict, secure permissions
chown -R root:root "${DEST_DIR}"
find "${DEST_DIR}" -type d -exec chmod 755 {} +
find "${DEST_DIR}" -type f -exec chmod 644 {} +

echo -e "${YELLOW}[2/6] Registering cPanel AppConfig...${NC}"
mkdir -p /var/cpanel/apps
cp "${REPO_ROOT}/cpanel/appconfig/fandejo.conf" /var/cpanel/apps/fandejo.conf
chmod 644 /var/cpanel/apps/fandejo.conf
/usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/fandejo.conf

echo -e "${YELLOW}[3/6] Registering DynamicUI for Jupiter theme...${NC}"
if [[ -x "/usr/local/cpanel/scripts/install_plugin" ]]; then
    # Create temporary tarball for install_plugin
    TMP_PLUGIN_DIR="$(mktemp -d /tmp/fandejo_plugin.XXXXXX)"
    cp "${REPO_ROOT}/cpanel/dynamicui/install.json" "${TMP_PLUGIN_DIR}/"
    cp "${REPO_ROOT}/cpanel/dynamicui/fandejo.svg" "${TMP_PLUGIN_DIR}/"
    (
        cd "${TMP_PLUGIN_DIR}"
        tar -czf "${TMP_PLUGIN_DIR}/fandejo.tar.gz" *
        /usr/local/cpanel/scripts/install_plugin "${TMP_PLUGIN_DIR}/fandejo.tar.gz" --theme=jupiter || true
    )
    rm -rf "${TMP_PLUGIN_DIR}"
fi

echo -e "${YELLOW}[4/6] Registering WHM Feature Manager flag...${NC}"
mkdir -p /var/cpanel/features
cp "${REPO_ROOT}/cpanel/features/fandejo" /var/cpanel/features/fandejo
chmod 644 /var/cpanel/features/fandejo

echo -e "${YELLOW}[5/6] Checking CloudLinux / CageFS compatibility...${NC}"
if [[ -x "/usr/sbin/cagefsctl" ]]; then
    echo -e "${CYAN}CageFS detected. Adding Fandejo to CageFS skeleton...${NC}"
    /usr/sbin/cagefsctl --addrpm fandejo-cpanel 2>/dev/null || true
    /usr/sbin/cagefsctl --force-update || true
else
    echo -e "CageFS not active, skipping."
fi

echo -e "${YELLOW}[6/6] Rebuilding theme and application caches...${NC}"
if [[ -x "/usr/local/cpanel/bin/rebuild_sprites" ]]; then
    /usr/local/cpanel/bin/rebuild_sprites || true
fi
if [[ -x "/usr/local/cpanel/scripts/update_theme_cache" ]]; then
    /usr/local/cpanel/scripts/update_theme_cache || true
fi

echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}[SUCCESS] Fandejo cPanel Plugin successfully installed!${NC}"
echo -e "${GREEN}Fandejo is now visible under the 'Databases' section in cPanel (Jupiter).${NC}"
echo -e "${GREEN}==============================================================================${NC}"
