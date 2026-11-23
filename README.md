# Fandejo cPanel Plugin

Official cPanel & WHM integration plugin for **Fandejo** — the fast, modern database workbench for MariaDB, MySQL, and SQLite3 developed by [Toondout](https://toondout.com).

## Overview

This plugin seamlessly embeds Fandejo into the **cPanel (Jupiter theme)** interface and **WHM (Web Host Manager)**:
- **Native Jupiter Integration:** Adds a Fandejo icon under the **Databases** section in cPanel.
- **Single Sign-On (SSO):** Automatically connects authenticated cPanel users to their MySQL/MariaDB databases via local socket/UAPI without prompting for passwords.
- **Multi-Tenant SQLite Sandboxing:** Automatically isolates and discovers SQLite databases inside `/home/$user/` with strict per-user permission boundaries.
- **WHM Feature Manager Control:** Server administrators can enable or disable Fandejo per hosting package.
- **CloudLinux & CageFS Ready:** Compliant with CageFS chroot environments and CloudLinux LVE resource limits.

## Directory Structure

```text
├── cpanel/
│   ├── appconfig/
│   │   └── fandejo.conf       # cPanel AppConfig registration file
│   ├── dynamicui/
│   │   ├── install.json       # Jupiter dynamic UI registration definition
│   │   └── fandejo.svg        # 48x48 vector icon for cPanel Jupiter UI
│   └── features/
│       └── fandejo            # WHM Feature Manager definition
├── src/
│   ├── index.live.php         # cPanel LiveAPI bootstrap & SSO entry point
│   ├── bridge.php             # Session token & multi-tenant path resolver
│   └── ...                    # Core Fandejo assets
├── scripts/
│   ├── install.sh             # Server-wide installation and registration script
│   └── uninstall.sh           # Clean removal and cache purge script
└── packaging/
    └── fandejo-cpanel.spec    # RPM package spec for AlmaLinux / CloudLinux 8 & 9
```

## Quick Installation (on cPanel & WHM Server)

```bash
git clone ssh://forgejo@forgejo.toondout.com/bholland/Fandejo-CPanel.git /usr/local/src/fandejo-cpanel
cd /usr/local/src/fandejo-cpanel
sudo ./scripts/install.sh
```

## Uninstallation

```bash
sudo ./scripts/uninstall.sh
```

## License

Released under the [Fandejo Source-Available & Free-Use License](LICENSE).
Author: [Toondout](https://toondout.com)
