# Fandejo Database Workbench — cPanel & WHM Plugin

[![Release](https://img.shields.io/github/v/release/Toondout-Development/Fandejo-Cpanel?style=flat-square&color=orange)](https://github.com/Toondout-Development/Fandejo-Cpanel/releases)
[![License](https://img.shields.io/badge/license-Free--Use-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/cPanel-Jupiter%20Theme-orange?style=flat-square)](https://cpanel.net)
[![OS](https://img.shields.io/badge/OS-AlmaLinux%20|%20CloudLinux%20|%20RHEL-green?style=flat-square)](https://almalinux.org)

Official cPanel & WHM integration plugin for **Fandejo** — the fast, modern, high-performance database workbench for MariaDB, MySQL, and SQLite3 developed by [Toondout Development](https://www.toondout.com).

---

## Highlights

- **Native Jupiter Theme Integration:** Placed under the **Databases** category with native SVG styling and launch in a new window (`target="_blank"`).
- **Single Sign-On (SSO):** Automatically authenticates cPanel users using dynamic session credentials without entering passwords.
- **One-Click Engine Switcher:** Instant toggle between **🐬 MariaDB/MySQL** and **🗄️ SQLite3** right in the workbench header.
- **Multi-Tenant SQLite Sandboxing:** Automatically discovers and sandboxes SQLite databases within the tenant's home directory (`/home/$user/`).
- **Bulk Table Operations:** Master "Select All" checkbox with bulk Drop and Truncate actions.
- **WHM Feature Manager Control:** Enable or disable Fandejo per hosting package or feature list with one checkbox in WHM.
- **CloudLinux & CageFS Ready:** Full compliance with CageFS filesystem sandboxing and LVE tenant boundaries.

---

## Quick Installation

### Option A: Install via RPM (Recommended)

Run as `root` on any cPanel server (AlmaLinux, CloudLinux, RHEL, or Rocky Linux 8 & 9):

```bash
rpm -ivh https://github.com/Toondout-Development/Fandejo-Cpanel/releases/latest/download/fandejo-cpanel-1.0.0-1.el9.noarch.rpm
```

### Option B: Install via Git & Shell Script

```bash
git clone https://github.com/Toondout-Development/Fandejo-Cpanel.git /usr/local/src/fandejo-cpanel
cd /usr/local/src/fandejo-cpanel
sudo ./scripts/install.sh
```

---

## Documentation

- 📖 **[Administrator Guide](docs/admin-guide.md):** Installation, WHM Feature Manager, CloudLinux CageFS, and troubleshooting.
- 💻 **[User Guide](docs/user-guide.md):** Navigation, MariaDB/MySQL workflows, sandboxed SQLite management, and bulk table operations.
- ⚖️ **[Standalone vs. Plugin Comparison](docs/standalone-vs-plugin.md):** Architectural differences between standalone Fandejo and the cPanel edition.

---

## Uninstallation

### If installed via RPM:
```bash
rpm -e fandejo-cpanel
```

### If installed via shell script:
```bash
sudo /usr/local/src/fandejo-cpanel/scripts/uninstall.sh
```

---

## License & Attribution

Released under the [Fandejo Free-Use License](LICENSE).  
Canonical Repository: [github.com/Toondout-Development/Fandejo-Cpanel](https://github.com/Toondout-Development/Fandejo-Cpanel)  
Author & Maintainer: [Toondout Development](https://www.toondout.com)
