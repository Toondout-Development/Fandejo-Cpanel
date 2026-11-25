# Standalone vs. cPanel Plugin — Fandejo Editions

Fandejo is available in two packaging formats: **Standalone Edition** and **cPanel & WHM Plugin Edition**.

---

## Comparison Matrix

| Feature | Standalone Edition | cPanel & WHM Plugin |
| :--- | :--- | :--- |
| **Target Audience** | Self-hosted servers, Docker containers, local development | Shared hosting providers, multi-tenant hosting environments |
| **Web Server** | Nginx, Apache, Caddy, PHP built-in server | cPanel `cpsrvd` LiveAPI daemon (`port 2083/2087`) |
| **Authentication** | Direct DB credentials or Argon2id SQLite auth | Zero-config Single Sign-On (SSO) via cPanel session tokens |
| **Multi-Tenancy** | Single-user or shared instance | Strict per-tenant isolation (`/home/$user/.fandejo/`) |
| **SQLite Catalog** | Global allowed directories configured in `config.php` | Automatically sandboxed strictly to the tenant's home root |
| **Theme Integration**| Standalone browser SPA | Native cPanel Jupiter theme icon & launch in new tab |
| **Management** | Manual configuration files | WHM Feature Manager package control |
| **Packaging** | Git repository / Docker image / tarball | Automated `.rpm` package (EL8/EL9) & manual installer |

---

## Standalone Deployment

For developers running Fandejo on an independent VPS or container without cPanel:

```bash
# Clone the repository
git clone https://github.com/Toondout-Development/Fandejo.git /var/www/fandejo
cd /var/www/fandejo

# Configure web server (Nginx/Apache) root to the public directory
# Ensure PHP 8.1+ with PDO MySQL / SQLite is installed
```

## cPanel & WHM Deployment

For web hosting providers managing cPanel servers:

```bash
# Install via RPM in one command
rpm -ivh https://github.com/Toondout-Development/Fandejo-Cpanel/releases/latest/download/fandejo-cpanel-1.0.0-1.el9.noarch.rpm
```
