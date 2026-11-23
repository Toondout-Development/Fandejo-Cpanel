#!/usr/bin/env bash
# ==============================================================================
# Fandejo cPanel Plugin Uninstaller
# Cleanly unregisters and removes Fandejo from cPanel & WHM
# Author: Toondout (https://toondout.com)
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${CYAN}              Fandejo Database Workbench — cPanel Uninstaller                ${NC}"
echo -e "${CYAN}==============================================================================${NC}"

# 1. Root check
if [[ "${EUID}" -ne 0 ]]; then
    echo -e "${RED}[ERROR] This uninstaller must be run as root.${NC}" >&2
    exit 1
fi

echo -e "${YELLOW}[1/5] Unregistering cPanel AppConfig...${NC}"
if [[ -x "/usr/local/cpanel/bin/unregister_appconfig" ]]; then
    /usr/local/cpanel/bin/unregister_appconfig fandejo || true
fi
rm -f /var/cpanel/apps/fandejo.conf

echo -e "${YELLOW}[2/5] Removing plugin from Jupiter theme...${NC}"
if [[ -x "/usr/local/cpanel/scripts/uninstall_plugin" ]]; then
    /usr/local/cpanel/scripts/uninstall_plugin fandejo --theme=jupiter || true
fi

echo -e "${YELLOW}[3/5] Removing WHM Feature Manager flag...${NC}"
rm -f /var/cpanel/features/fandejo

echo -e "${YELLOW}[4/5] Removing plugin files...${NC}"
rm -rf /usr/local/cpanel/base/frontend/jupiter/fandejo

echo -e "${YELLOW}[5/5] Refreshing caches and CageFS...${NC}"
if [[ -x "/usr/sbin/cagefsctl" ]]; then
    /usr/sbin/cagefsctl --force-update || true
fi
if [[ -x "/usr/local/cpanel/scripts/update_theme_cache" ]]; then
    /usr/local/cpanel/scripts/update_theme_cache || true
fi

echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}[SUCCESS] Fandejo cPanel Plugin completely uninstalled.${NC}"
echo -e "${GREEN}==============================================================================${NC}"
