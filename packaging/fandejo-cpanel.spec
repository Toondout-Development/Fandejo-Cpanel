Name:           fandejo-cpanel
Version:        1.0.0
Release:        1%{?dist}
Summary:        Fandejo Database Workbench integration for cPanel & WHM
License:        Fandejo Free-Use License
URL:            https://github.com/Toondout-Development/Fandejo-Cpanel
Vendor:         Toondout <https://www.toondout.com>
BuildArch:      noarch

Requires:       cpanel
Requires:       ea-php81-php-pdo || ea-php82-php-pdo || ea-php83-php-pdo || ea-php84-php-pdo || php-pdo

%description
Fandejo is a fast, lightweight database administration workbench for
MariaDB, MySQL, and SQLite3. This package integrates Fandejo into the
cPanel Jupiter interface with Single Sign-On (SSO), per-tenant SQLite
sandboxing, and WHM Feature Manager management.

%prep
# No prep required for pre-built source

%build
# Pure PHP/JS web application; no compilation required

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/usr/local/cpanel/base/3rdparty/fandejo
mkdir -p %{buildroot}/usr/local/cpanel/base/frontend/jupiter
mkdir -p %{buildroot}/var/cpanel/apps
mkdir -p %{buildroot}/var/cpanel/features

# Install runtime web files
cp -r %{_sourcedir}/src/* %{buildroot}/usr/local/cpanel/base/3rdparty/fandejo/
cp %{_sourcedir}/cpanel/dynamicui/fandejo.svg %{buildroot}/usr/local/cpanel/base/3rdparty/fandejo/

# Symlink to Jupiter frontend directory
ln -sfn /usr/local/cpanel/base/3rdparty/fandejo %{buildroot}/usr/local/cpanel/base/frontend/jupiter/fandejo

# Install AppConfig configuration
install -m 0644 %{_sourcedir}/cpanel/appconfig/fandejo.conf %{buildroot}/var/cpanel/apps/fandejo.conf

# Install WHM Feature Manager definition
install -m 0644 %{_sourcedir}/cpanel/features/fandejo %{buildroot}/var/cpanel/features/fandejo

%post
# Register AppConfig with cpsrvd
if [ -x /usr/local/cpanel/bin/register_appconfig ]; then
    /usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/fandejo.conf || true
fi

# Rebuild cPanel theme cache and CloudLinux CageFS
if [ -x /usr/local/cpanel/scripts/update_theme_cache ]; then
    /usr/local/cpanel/scripts/update_theme_cache || true
fi
if [ -x /usr/sbin/cagefsctl ]; then
    /usr/sbin/cagefsctl --addrpm fandejo-cpanel || true
    /usr/sbin/cagefsctl --force-update || true
fi

%preun
if [ $1 -eq 0 ]; then
    # Unregister AppConfig on uninstall
    if [ -x /usr/local/cpanel/bin/unregister_appconfig ]; then
        /usr/local/cpanel/bin/unregister_appconfig fandejo || true
    fi
fi

%postun
if [ $1 -eq 0 ]; then
    # Refresh caches after removal
    if [ -x /usr/local/cpanel/scripts/update_theme_cache ]; then
        /usr/local/cpanel/scripts/update_theme_cache || true
    fi
    if [ -x /usr/sbin/cagefsctl ]; then
        /usr/sbin/cagefsctl --force-update || true
    fi
fi

%files
%defattr(-,root,root,-)
/usr/local/cpanel/base/3rdparty/fandejo
/usr/local/cpanel/base/frontend/jupiter/fandejo
/var/cpanel/apps/fandejo.conf
/var/cpanel/features/fandejo

%changelog
* Mon Nov 23 2026 Toondout <https://www.toondout.com> - 1.0.0-1
- Initial release of Fandejo cPanel & WHM plugin
