# Administrator Guide — Fandejo for cPanel & WHM

This guide covers installing, configuring, managing, and maintaining Fandejo Database Workbench across multi-tenant cPanel and CloudLinux environments.

---

## 1. Architecture & Security Model

Fandejo is built from the ground up for modern shared and dedicated cPanel web hosting:

- **Isolated Process Execution:** Fandejo executes under cPanel's `cpsrvd` LiveAPI wrapper (`*.live.php`) as the authenticated cPanel user (`$authuser`), ensuring full adherence to POSIX permissions, disk quotas, and system process limits.
- **Root Protection:** Core application files in `/usr/local/cpanel/base/3rdparty/fandejo/` are owned by `root:root` and mounted read-only for tenants.
- **Tenant Sandboxing:** All user settings, session files, history, locks, and SQLite database catalog records reside exclusively within `/home/$user/.fandejo/` (permission `0700`).
- **Single Sign-On (SSO):** Authenticates users into local MariaDB/MySQL databases using cPanel's dynamic session environment (`REMOTE_USER` and `REMOTE_PASSWORD`), eliminating password prompts.
- **CloudLinux CageFS Compatibility:** Fandejo seamlessly integrates with CageFS skeletons to ensure multi-tenant boundary compliance.

---

## 2. Installation Methods

### Option A: RPM Installation (Recommended)

Pre-built RPM packages are available for RHEL 8/9, AlmaLinux 8/9, Rocky Linux 8/9, and CloudLinux 8/9:

```bash
# Install directly from the GitHub Release
rpm -ivh https://github.com/Toondout-Development/Fandejo-Cpanel/releases/latest/download/fandejo-cpanel-1.0.0-1.el9.noarch.rpm

# Or via dnf:
dnf install https://github.com/Toondout-Development/Fandejo-Cpanel/releases/latest/download/fandejo-cpanel-1.0.0-1.el9.noarch.rpm
```

The RPM package automatically:
1. Registers Fandejo with cPanel `AppConfig`.
2. Registers the DynamicUI manifest for the Jupiter theme.
3. Adds the Feature Manager flag in WHM.
4. Updates CloudLinux CageFS if active.
5. Rebuilds theme and sprite caches.

### Option B: Manual Shell Installer

```bash
git clone https://github.com/Toondout-Development/Fandejo-Cpanel.git /usr/local/src/fandejo-cpanel
cd /usr/local/src/fandejo-cpanel
chmod +x scripts/install.sh
./scripts/install.sh
```

---

## 3. WHM Feature Manager Control

Hosting providers can enable or disable Fandejo per hosting package or cPanel feature list:

1. Log into **WHM** (`https://your-server:2087`).
2. Navigate to **Packages** ➔ **Feature Manager**.
3. Select a feature list to edit (e.g., `default`).
4. Find **Fandejo** under the feature list:
   - Check the box to enable Fandejo for accounts using this feature list.
   - Uncheck the box to hide Fandejo completely from those accounts.
5. Click **Save**.

---

## 4. CloudLinux & CageFS

If your server runs CloudLinux OS with CageFS enabled:

```bash
# Add Fandejo RPM to CageFS skeleton
cagefsctl --addrpm fandejo-cpanel

# Force update CageFS skeleton
cagefsctl --force-update
```

Tenants imprisoned in CageFS will have full access to Fandejo with their SQLite catalog strictly isolated to their own `/home/$user/` filesystem namespace.

---

## 5. Uninstallation

### If installed via RPM:
```bash
rpm -e fandejo-cpanel
```

### If installed via manual script:
```bash
/usr/local/src/fandejo-cpanel/scripts/uninstall.sh
```

Uninstallation cleanly unregisters AppConfig, deletes Jupiter theme icons and DynamicUI links, and refreshes the theme caches. Tenant data inside `/home/$user/.fandejo/` is preserved.
