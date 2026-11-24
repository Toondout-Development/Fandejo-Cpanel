<?php
/**
 * Fandejo cPanel Multi-Tenant & SSO Bridge
 *
 * Provides seamless integration with cPanel cpsrvd:
 * - Detects authenticated cPanel tenant ($authuser)
 * - Isolates configurations, locks, and history strictly within /home/$user/.fandejo/
 * - Implements passwordless Unix socket / UAPI Single Sign-On (SSO)
 * - Restricts SQLite catalog scans within the tenant's home directory
 */

declare(strict_types=1);

class FandejoCpanelBridge {
    public static ?string $user = null;
    public static ?string $homeDir = null;
    public static ?string $userFandejoDir = null;

    /**
     * Bootstrap the cPanel environment.
     */
    public static function init(): void {
        self::initLiveApi();
        self::detectUser();
        self::setupTenantStorage();
    }

    /**
     * Connect to cPanel's internal LiveAPI socket if invoked via cpsrvd (.live.php wrapper).
     */
    public static function initLiveApi(): void {
        if (file_exists('/usr/local/cpanel/php/cpanel.php') && getenv('CPANEL_PHPCONNECT_SOCKET')) {
            try {
                require_once '/usr/local/cpanel/php/cpanel.php';
                $cpanel = new CPANEL();
                register_shutdown_function(function() use ($cpanel) {
                    try { $cpanel->end(); } catch (Throwable) {}
                });
            } catch (Throwable) {}
        }
    }

    /**
     * Detect the authenticated cPanel user.
     */
    public static function detectUser(): string {
        if (self::$user !== null) {
            return self::$user;
        }

        // 1. Check REMOTE_USER provided by cPanel cpsrvd
        $u = $_SERVER['REMOTE_USER'] ?? null;

        // 2. Fallback to process owner / POSIX UID
        if (!$u && function_exists('posix_geteuid') && function_exists('posix_getpwuid')) {
            $pw = posix_getpwuid(posix_geteuid());
            if ($pw && !empty($pw['name'])) {
                $u = $pw['name'];
                self::$homeDir = $pw['dir'] ?? null;
            }
        }

        // 3. Fallback to environment variables
        if (!$u) {
            $u = getenv('USER') ?: (getenv('LOGNAME') ?: 'nobody');
        }

        self::$user = (string)$u;

        if (!self::$homeDir) {
            self::$homeDir = is_dir("/home/{$u}") ? "/home/{$u}" : sys_get_temp_dir();
        }

        self::$userFandejoDir = self::$homeDir . '/.fandejo';
        return self::$user;
    }

    /**
     * Configure isolated per-user storage paths for Fandejo.
     */
    public static function setupTenantStorage(): void {
        $user = self::detectUser();
        $targetDir = self::$userFandejoDir;

        // Create ~/.fandejo with strict 0700 permissions
        if (!is_dir($targetDir)) {
            @mkdir($targetDir, 0700, true);
        }

        // Isolate session storage inside tenant directory to avoid shared /var/lib/php/sessions permission issues
        $sessDir = "{$targetDir}/sessions";
        if (!is_dir($sessDir)) {
            @mkdir($sessDir, 0700, true);
        }
        if (!headers_sent() && session_status() === PHP_SESSION_NONE && is_dir($sessDir) && is_writable($sessDir)) {
            ini_set('session.save_path', $sessDir);
        }

        // Ensure environment overrides are set for Fandejo's core API
        $cfgFile = "{$targetDir}/config.php";
        $locksFile = "{$targetDir}/locks.json";

        putenv("FANDEJO_CONFIG={$cfgFile}");
        putenv("FANDEJO_LOCKS_FILE={$locksFile}");
        putenv("FANDEJO_SQLITE_USER={$user}");

        // If user config does not exist, initialize with home directory SQLite paths
        if (!file_exists($cfgFile) && is_writable($targetDir)) {
            $initialConfig = [
                'sqlite_dirs' => array_filter([
                    self::$homeDir . '/data',
                    self::$homeDir . '/public_html',
                    self::$homeDir . '/databases',
                ], 'is_dir'),
                'sqlite_allow_any_dir' => false,
                'sqlite_base_root' => self::$homeDir,
                'sqlite_users' => [],
                'max_login_attempts' => 10,
                'admin_lockout_seconds' => 900,
                'ip_max_attempts' => 20,
                'ip_lockout_seconds' => 900,
                'session_idle_ttl' => 3600,
            ];

            $code = "<?php\n// Fandejo cPanel Tenant Configuration for {$user}\nreturn " . var_export($initialConfig, true) . ";\n";
            @file_put_contents($cfgFile, $code, LOCK_EX);
            @chmod($cfgFile, 0600);
        }
    }

    /**
     * Attempt Single Sign-On (SSO) for MariaDB/MySQL.
     * Checks local Unix domain socket authentication.
     */
    /**
     * Attempt Single Sign-On (SSO) for MariaDB/MySQL.
     * Checks:
     * 1. cPanel LiveAPI dynamic environment credentials (REMOTE_PASSWORD / REMOTE_DBOWNER)
     * 2. Tenant ~/.my.cnf credentials
     * 3. Local Unix domain socket passwordless auth
     */
    public static function attemptSocketSSO(): ?array {
        $user = self::detectUser();
        if ($user === 'nobody' || $user === 'root') {
            return null;
        }

        $sockets = [
            '/var/lib/mysql/mysql.sock',
            '/var/run/mysqld/mysqld.sock',
            '/tmp/mysql.sock',
        ];

        $sockPath = null;
        foreach ($sockets as $s) {
            if (file_exists($s)) {
                $sockPath = $s;
                break;
            }
        }

        // 1. Check cPanel LiveAPI dynamic credentials from environment
        $remotePass = getenv('REMOTE_PASSWORD') ?: ($_SERVER['REMOTE_PASSWORD'] ?? null) ?: ($_ENV['REMOTE_PASSWORD'] ?? null);
        $dbUser = getenv('REMOTE_DBOWNER') ?: ($_SERVER['REMOTE_DBOWNER'] ?? null) ?: ($_ENV['REMOTE_DBOWNER'] ?? null) ?: $user;

        if (!empty($remotePass) && is_string($remotePass)) {
            try {
                $dsn = $sockPath ? "mysql:unix_socket={$sockPath}" : "mysql:host=localhost;port=3306";
                $pdo = new PDO($dsn, $dbUser, $remotePass, [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_TIMEOUT => 2,
                ]);

                return [
                    'driver' => 'mysql',
                    'user' => $dbUser,
                    'pass' => $remotePass,
                    'socket' => $sockPath,
                    'host' => 'localhost',
                    'port' => 3306,
                    'sso' => true,
                ];
            } catch (Throwable) {}
        }

        // 2. Check tenant ~/.my.cnf credentials
        $myCnf = (self::$homeDir ?: ('/home/' . $user)) . '/.my.cnf';
        if (is_readable($myCnf)) {
            $parsed = @parse_ini_file($myCnf, true);
            $cnfUser = $parsed['client']['user'] ?? ($parsed['mysql']['user'] ?? null);
            $cnfPass = $parsed['client']['password'] ?? ($parsed['mysql']['password'] ?? null);
            if (!empty($cnfUser) && !empty($cnfPass)) {
                try {
                    $dsn = $sockPath ? "mysql:unix_socket={$sockPath}" : "mysql:host=localhost;port=3306";
                    $pdo = new PDO($dsn, $cnfUser, $cnfPass, [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_TIMEOUT => 2,
                    ]);

                    return [
                        'driver' => 'mysql',
                        'user' => $cnfUser,
                        'pass' => $cnfPass,
                        'socket' => $sockPath,
                        'host' => 'localhost',
                        'port' => 3306,
                        'sso' => true,
                    ];
                } catch (Throwable) {}
            }
        }

        if (!$sockPath) {
            return null;
        }

        // 3. Test passwordless connection via Unix domain socket
        try {
            $dsn = "mysql:unix_socket={$sockPath}";
            $pdo = new PDO($dsn, $user, '', [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 2,
            ]);

            return [
                'driver' => 'mysql',
                'user' => $user,
                'pass' => '',
                'socket' => $sockPath,
                'host' => 'localhost',
                'port' => 3306,
                'sso' => true,
            ];
        } catch (Throwable) {
            // Passwordless socket auth not enabled for this user; user will use standard login prompt
            return null;
        }
    }

    /**
     * Query cPanel's UAPI for user databases if cPanel's internal PHP module is present.
     */
    public static function getCpanelDatabases(): array {
        if (!file_exists('/usr/local/cpanel/php/cpanel.php')) {
            return [];
        }

        try {
            require_once '/usr/local/cpanel/php/cpanel.php';
            $cpanel = new CPANEL();
            $response = $cpanel->uapi('Mysql', 'list_databases');
            $dbs = [];
            if (!empty($response['cpanelresult']['result']['data'])) {
                foreach ($response['cpanelresult']['result']['data'] as $entry) {
                    if (!empty($entry['database'])) {
                        $dbs[] = $entry['database'];
                    }
                }
            }
            return $dbs;
        } catch (Throwable) {
            return [];
        }
    }
}

// Auto-initialize when included
FandejoCpanelBridge::init();
