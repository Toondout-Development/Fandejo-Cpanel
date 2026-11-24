<?php
declare(strict_types=1);
require_once __DIR__ . '/bridge.php';
if (PHP_SAPI === 'cli' && isset($argv[1]) && str_starts_with($argv[1], '--unlock')) {
    $target = str_contains($argv[1], '=') ? trim(substr($argv[1], strpos($argv[1], '=') + 1)) : ($argv[2] ?? '');
    $root = dirname(__DIR__);
    $files = array_filter([
        $root . '/data/.fandejo_locks.json',
        $root . '/.fandejo_locks.json',
        sys_get_temp_dir() . '/fandejo_locks_' . substr(hash('sha256', __FILE__), 0, 12) . '.json',
    ], 'is_file');
    if (!$files) { echo "No active lockout file found.\n"; exit(0); }
    foreach ($files as $f) {
        if ($target === '') {
            @unlink($f);
            echo "Cleared all Fandejo account and IP lockouts ($f).\n";
        } else {
            $data = json_decode((string)@file_get_contents($f), true) ?: ['accounts' => [], 'ips' => []];
            $removed = 0;
            foreach (array_keys($data['accounts'] ?? []) as $k) {
                $u = $data['accounts'][$k]['user'] ?? '';
                if ($k === $target || strcasecmp($u, $target) === 0) { unset($data['accounts'][$k]); $removed++; }
            }
            if (isset($data['ips'][$target])) { unset($data['ips'][$target]); $removed++; }
            @file_put_contents($f, json_encode($data, JSON_PRETTY_PRINT), LOCK_EX);
            @chmod($f, 0660);
            echo "Unlocked '$target' ($removed entry removed from $f).\n";
        }
    }
    exit(0);
}
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$cookiePath = ($scriptDir !== '' && $scriptDir !== '.' && str_starts_with($scriptDir, '/')) ? $scriptDir . '/' : '/';
session_name('fandejo_sid');
session_set_cookie_params(['lifetime' => 0, 'path' => $cookiePath, 'secure' => $isHttps, 'httponly' => true, 'samesite' => 'Strict']);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store, no-cache, must-revalidate');

function out($data, int $code = 200): never { http_response_code($code); echo json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR); exit; }
function fail(string $m, int $code = 400): never { out(['error' => $m], $code); }

/** Encrypt plaintext DB password using a split key stored only in an HttpOnly browser cookie. */
function seal_secret(string $plain): string {
    global $isHttps, $cookiePath;
    $key = sodium_crypto_secretbox_keygen();
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $cipher = sodium_crypto_secretbox($plain, $nonce, $key);
    $hexKey = sodium_bin2hex($key);
    setcookie('fandejo_key', $hexKey, ['expires' => 0, 'path' => $cookiePath, 'secure' => $isHttps, 'httponly' => true, 'samesite' => 'Strict']);
    $_COOKIE['fandejo_key'] = $hexKey;
    return sodium_bin2hex($nonce . $cipher);
}
function open_secret(string $sealed): ?string {
    $hexKey = $_COOKIE['fandejo_key'] ?? ($_COOKIE['typhon_key'] ?? '');
    if (strlen($hexKey) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES * 2 || $sealed === '') return null;
    try {
        $raw = sodium_hex2bin($sealed);
        $key = sodium_hex2bin($hexKey);
        if (strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) return null;
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
        return $plain === false ? null : $plain;
    } catch (Throwable) { return null; }
}
function clear_auth(): void {
    global $isHttps, $cookiePath;
    $_SESSION = [];
    foreach (array_unique([$cookiePath, '/']) as $cp) {
        setcookie('fandejo_key', '', ['expires' => time() - 3600, 'path' => $cp, 'secure' => $isHttps, 'httponly' => true, 'samesite' => 'Strict']);
        setcookie('typhon_key', '', ['expires' => time() - 3600, 'path' => $cp, 'secure' => $isHttps, 'httponly' => true, 'samesite' => 'Strict']);
    }
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
}
function session_fingerprint(): string {
    return hash('sha256', ($_SERVER['HTTP_USER_AGENT'] ?? '') . '|' . ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''));
}
function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
}

function q(string $id, string $drv): string {
    return $drv === 'mysql' ? '`' . str_replace('`', '``', $id) . '`' : '"' . str_replace('"', '""', $id) . '"';
}

const SQLITE_EXTS = ['sqlite', 'sqlite3', 'db'];

function fandejo_version(): string {
    $vf = dirname(__DIR__) . '/VERSION';
    if (is_file($vf)) {
        $v = trim((string)@file_get_contents($vf));
        if ($v !== '') return $v;
    }
    return 'v1.0.2';
}

/** Load config.php (from project root or public/, or FANDEJO_CONFIG env var) combined with sensible defaults. */
function fandejo_config(): array {
    $envCfg = getenv('FANDEJO_CONFIG');
    $cfgFile = ($envCfg && is_string($envCfg))
        ? $envCfg
        : (is_file(__DIR__ . '/../config.php') ? __DIR__ . '/../config.php' : (is_file(__DIR__ . '/config.php') ? __DIR__ . '/config.php' : null));
    $defaultBase = ($envCfg && is_string($envCfg)) ? dirname($envCfg) : dirname(__DIR__);
    $raw = ($cfgFile && is_file($cfgFile)) ? (require $cfgFile) : [];
    if (!is_array($raw)) $raw = [];
    $dirs = $raw['sqlite_dirs'] ?? [$defaultBase . '/data'];
    if (is_string($dirs)) $dirs = [$dirs];
    $cleanDirs = [];
    foreach ($dirs as $d) {
        $d = rtrim(trim((string)$d), '/\\');
        if ($d !== '') $cleanDirs[] = $d;
    }
    if (!$cleanDirs) $cleanDirs = [$defaultBase . '/data'];
    $users = [];
    if (!empty($raw['sqlite_users']) && is_array($raw['sqlite_users'])) {
        foreach ($raw['sqlite_users'] as $u => $h) {
            if (is_string($u) && $u !== '' && is_string($h) && $h !== '') $users[$u] = $h;
        }
    }
    if (!empty($raw['sqlite_password_hash']) && is_string($raw['sqlite_password_hash'])) {
        $u = !empty($raw['sqlite_user']) && is_string($raw['sqlite_user']) ? $raw['sqlite_user'] : 'admin';
        $users[$u] ??= $raw['sqlite_password_hash'];
    }
    if (($envHash = getenv('FANDEJO_SQLITE_HASH')) && is_string($envHash)) {
        $envUser = getenv('FANDEJO_SQLITE_USER') ?: 'admin';
        $users[$envUser] = $envHash;
    }
    return [
        'cfg_file' => $cfgFile ?? ($defaultBase . '/config.php'),
        'sqlite_dirs' => $cleanDirs,
        'sqlite_allow_any_dir' => !empty($raw['sqlite_allow_any_dir']),
        'sqlite_base_root' => isset($raw['sqlite_base_root']) && is_string($raw['sqlite_base_root']) ? rtrim($raw['sqlite_base_root'], '/\\') : $defaultBase,
        'sqlite_users' => $users,
        'max_login_attempts' => max(2, (int)($raw['max_login_attempts'] ?? 5)),
        'admin_lockout_seconds' => max(60, (int)($raw['admin_lockout_seconds'] ?? 900)),
        'ip_max_attempts' => max(3, (int)($raw['ip_max_attempts'] ?? 12)),
        'ip_lockout_seconds' => max(60, (int)($raw['ip_lockout_seconds'] ?? 900)),
        'session_idle_ttl' => max(300, (int)($raw['session_idle_ttl'] ?? 3600)),
    ];
}

function save_sqlite_config(array $dirs, array $users): void {
    $envCfg = getenv('FANDEJO_CONFIG');
    $cfgFile = ($envCfg && is_string($envCfg))
        ? $envCfg
        : (is_file(__DIR__ . '/../config.php') ? __DIR__ . '/../config.php' : (dirname(__DIR__) . '/config.php'));
    $existing = is_file($cfgFile) ? (require $cfgFile) : [];
    if (!is_array($existing)) $existing = [];
    $existing['sqlite_dirs'] = array_values($dirs);
    $existing['sqlite_users'] = $users;
    $code = "<?php\n// Fandejo Configuration — updated " . date('c') . "\nreturn " . var_export($existing, true) . ";\n";
    if (@file_put_contents($cfgFile, $code, LOCK_EX) === false) {
        fail('Unable to write config.php — check directory permissions or create config.php from config.example.php');
    }
    @chmod($cfgFile, 0600);
}

/** Persistent brute-force & account lockout store (prefers data/.fandejo_locks.json, root/.fandejo_locks.json, fallback to sys_get_temp_dir). */
function locks_file_path(): string {
    $envLocks = getenv('FANDEJO_LOCKS_FILE');
    if ($envLocks && is_string($envLocks)) return $envLocks;
    $root = dirname(__DIR__);
    $dataFile = $root . '/data/.fandejo_locks.json';
    $rootFile = $root . '/.fandejo_locks.json';

    // 1. Existing writable files
    if (is_file($dataFile) && is_writable($dataFile)) return $dataFile;
    if (is_file($rootFile) && is_writable($rootFile)) return $rootFile;

    // 2. Directories where a new file can be created
    if (is_dir($root . '/data') && is_writable($root . '/data')) return $dataFile;
    if (is_writable($root)) return $rootFile;

    // 3. Fallback to existing files even if not currently writable by current user
    if (is_file($dataFile)) return $dataFile;
    if (is_file($rootFile)) return $rootFile;

    return sys_get_temp_dir() . '/fandejo_locks_' . substr(hash('sha256', __FILE__), 0, 12) . '.json';
}
function load_locks(): array {
    $f = locks_file_path();
    $raw = is_file($f) ? @file_get_contents($f) : false;
    if ($raw === false) {
        $tempF = sys_get_temp_dir() . '/fandejo_locks_' . substr(hash('sha256', __FILE__), 0, 12) . '.json';
        if (is_file($tempF)) $raw = @file_get_contents($tempF);
    }
    if (!is_string($raw) || $raw === '') return ['accounts' => [], 'ips' => []];
    $data = json_decode($raw, true);
    if (!is_array($data)) return ['accounts' => [], 'ips' => []];
    // Normalize legacy account entries without by_ip map
    $accts = [];
    foreach ($data['accounts'] ?? [] as $k => $a) {
        if (!is_array($a)) continue;
        if (!isset($a['by_ip']) || !is_array($a['by_ip'])) {
            $lip = $a['last_ip'] ?? '127.0.0.1';
            $a['by_ip'] = [$lip => [
                'ip' => $lip,
                'attempts' => (int)($a['attempts'] ?? 0),
                'locked' => !empty($a['locked']),
                'locked_at' => $a['locked_at'] ?? ($a['last_failed'] ?? time()),
                'last_failed' => $a['last_failed'] ?? time(),
            ]];
        }
        $accts[$k] = $a;
    }
    return ['accounts' => $accts, 'ips' => $data['ips'] ?? []];
}
function save_locks(array $data): void {
    $f = locks_file_path();
    $written = @file_put_contents($f, json_encode($data, JSON_PRETTY_PRINT), LOCK_EX);
    if ($written === false) {
        // Fallback to temp directory if primary location permission was denied
        $f = sys_get_temp_dir() . '/fandejo_locks_' . substr(hash('sha256', __FILE__), 0, 12) . '.json';
        @file_put_contents($f, json_encode($data, JSON_PRETTY_PRINT), LOCK_EX);
    }
    @chmod($f, 0660);
}
function recompute_acct_lock_summary(array &$acct): void {
    $byIp = $acct['by_ip'] ?? [];
    $total = 0;
    $anyLocked = false;
    $lastFailed = 0;
    $lastIp = $acct['last_ip'] ?? '';
    foreach ($byIp as $ip => $entry) {
        $total += (int)($entry['attempts'] ?? 0);
        if (!empty($entry['locked'])) $anyLocked = true;
        if (($entry['last_failed'] ?? 0) >= $lastFailed) {
            $lastFailed = (int)($entry['last_failed'] ?? 0);
            $lastIp = (string)$ip;
        }
    }
    $acct['attempts'] = $total;
    $acct['locked'] = $anyLocked;
    $acct['global_locked'] = !empty($acct['global_locked']);
    if ($acct['global_locked']) $acct['locked'] = true;
    $acct['last_failed'] = $lastFailed ?: ($acct['last_failed'] ?? time());
    $acct['last_ip'] = $lastIp;
}
/**
 * Check if ($drv, $user) is permitted to attempt authentication from the current IP.
 * Returns true if the account is in "admin cooldown recovery probe" mode (meaning authentication
 * MUST only succeed if the credentials are valid AND the user is a full administrator).
 */
function check_login_lock(string $drv, string $user): bool {
    $cfg = fandejo_config();
    $locks = load_locks();
    $ip = client_ip();
    $now = time();
    $acctKey = strtolower($drv) . ':' . $user;
    $adminCooldown = $cfg['admin_lockout_seconds'];

    // 1. Check temporary IP-wide rate limit across accounts
    $ipEntry = $locks['ips'][$ip] ?? null;
    if ($ipEntry && !empty($ipEntry['locked_until'])) {
        if ($now < $ipEntry['locked_until']) {
            $rem = max(1, (int)ceil(($ipEntry['locked_until'] - $now) / 60));
            fail("Too many failed login attempts from your IP ($ip). Try again in {$rem} minute(s), or run `php public/api.php --unlock` on the server.", 429);
        }
        unset($locks['ips'][$ip]);
        save_locks($locks);
    }

    // 2. Check account lockouts (global admin lock or per-IP hard lock)
    $acct = $locks['accounts'][$acctKey] ?? null;
    if (!$acct) return false;

    $ipLock = $acct['by_ip'][$ip] ?? null;
    $isGlobalLocked = !empty($acct['global_locked']);
    $isIpLocked = !empty($ipLock['locked']);

    if (!$isGlobalLocked && !$isIpLocked) {
        // An attacker on another IP may be locked out on this account, but THIS client IP is clean!
        return false;
    }

    $lockedAt = (int)($isIpLocked ? ($ipLock['locked_at'] ?? $now) : ($acct['locked_at'] ?? $now));
    $elapsed = $now - $lockedAt;

    // 3. Anti-deadlock self-recovery window for full-privilege administrators:
    // Once admin_lockout_seconds has elapsed, allow a credential check that ONLY succeeds if the user is a full admin.
    if ($elapsed >= $adminCooldown) {
        return true; // Admin recovery probe mode
    }

    $remMin = max(1, (int)ceil(($adminCooldown - $elapsed) / 60));
    $attempts = (int)($ipLock['attempts'] ?? ($acct['attempts'] ?? $cfg['max_login_attempts']));
    fail("Account '$user' is locked for your IP ($ip) after $attempts failed attempts. An administrator can unlock it in the Users panel (or sign in from another IP, wait {$remMin}m for admin cooldown, or run `php public/api.php --unlock`).", 423);
}
function record_login_failure(string $drv, string $user, string $reason = 'Authentication failed'): never {
    $cfg = fandejo_config();
    $locks = load_locks();
    $ip = client_ip();
    $now = time();
    $maxAcct = $cfg['max_login_attempts'];
    $maxIp = $cfg['ip_max_attempts'];
    $acctKey = strtolower($drv) . ':' . ($user !== '' ? $user : '(empty)');

    $acct = $locks['accounts'][$acctKey] ?? ['driver' => $drv, 'user' => $user, 'attempts' => 0, 'locked' => false, 'global_locked' => false, 'by_ip' => []];
    $acct['driver'] = $drv;
    $acct['user'] = $user;
    $ipSlot = $acct['by_ip'][$ip] ?? ['ip' => $ip, 'attempts' => 0, 'locked' => false, 'locked_at' => null, 'last_failed' => $now];
    $ipSlot['attempts'] = ((int)($ipSlot['attempts'] ?? 0)) + 1;
    $ipSlot['last_failed'] = $now;
    if ($ipSlot['attempts'] >= $maxAcct && $user !== '') {
        $ipSlot['locked'] = true;
        $ipSlot['locked_at'] = $now; // Reset cooldown timer on repeated bad attempt
    }
    $acct['by_ip'][$ip] = $ipSlot;
    recompute_acct_lock_summary($acct);
    $locks['accounts'][$acctKey] = $acct;

    $ipEntry = $locks['ips'][$ip] ?? ['ip' => $ip, 'attempts' => 0, 'last_failed' => $now, 'locked_until' => null];
    if (($now - ($ipEntry['last_failed'] ?? 0)) > $cfg['ip_lockout_seconds']) {
        $ipEntry['attempts'] = 0;
    }
    $ipEntry['attempts'] = ((int)($ipEntry['attempts'] ?? 0)) + 1;
    $ipEntry['last_failed'] = $now;
    $ipEntry['last_user'] = $user;
    if ($ipEntry['attempts'] >= $maxIp) {
        $ipEntry['locked_until'] = $now + $cfg['ip_lockout_seconds'];
    }
    $locks['ips'][$ip] = $ipEntry;
    save_locks($locks);

    // Progressive tarpit delay (350ms * attempts from this IP, capped at 2s)
    usleep(min(2000000, $ipSlot['attempts'] * 350000));

    if (!empty($ipSlot['locked'])) {
        $mins = max(1, (int)ceil($cfg['admin_lockout_seconds'] / 60));
        fail("Account '$user' is now locked for your IP ($ip) after {$ipSlot['attempts']} failed attempts. An administrator must unlock it (or wait {$mins}m for admin cooldown / run `php public/api.php --unlock`).", 423);
    }
    $rem = max(0, $maxAcct - $ipSlot['attempts']);
    fail("$reason ($rem attempt" . ($rem === 1 ? '' : 's') . " remaining from your IP before lockout)", 401);
}
function clear_login_failures(string $drv, string $user): void {
    $locks = load_locks();
    $ip = client_ip();
    $acctKey = strtolower($drv) . ':' . $user;
    $changed = false;
    // Clear failures for this client IP only, preserving any attacker IPs still locked on this account so the admin can review them
    if (isset($locks['accounts'][$acctKey]['by_ip'][$ip])) {
        unset($locks['accounts'][$acctKey]['by_ip'][$ip]);
        if (!empty($locks['accounts'][$acctKey]['global_locked'])) {
            $locks['accounts'][$acctKey]['global_locked'] = false;
        }
        if (empty($locks['accounts'][$acctKey]['by_ip'])) {
            unset($locks['accounts'][$acctKey]);
        } else {
            recompute_acct_lock_summary($locks['accounts'][$acctKey]);
        }
        $changed = true;
    }
    if (isset($locks['ips'][$ip])) {
        unset($locks['ips'][$ip]);
        $changed = true;
    }
    if ($changed) save_locks($locks);
}
/** Determine whether the currently signed-in user has administrative privileges to manage lockouts & users. */
function is_full_admin(?PDO $p, string $drv, array $c): bool {
    if ($drv === 'sqlite') return true;
    if (!$p) return false;
    // 1. Check active connection grants via SHOW GRANTS (universal across MySQL & MariaDB)
    try {
        $lines = array_column($p->query('SHOW GRANTS')->fetchAll(PDO::FETCH_NUM), 0);
        foreach (parse_grant_lines($lines) as $s) {
            if ($s['db'] === '*' && ($s['all'] || in_array('CREATE USER', $s['privs'], true) || in_array('SUPER', $s['privs'], true))) return true;
        }
    } catch (Throwable) {}
    // 2. Fallback to standard SHOW GRANTS FOR CURRENT_USER()
    try {
        $lines = array_column($p->query('SHOW GRANTS FOR CURRENT_USER()')->fetchAll(PDO::FETCH_NUM), 0);
        foreach (parse_grant_lines($lines) as $s) {
            if ($s['db'] === '*' && ($s['all'] || in_array('CREATE USER', $s['privs'], true) || in_array('SUPER', $s['privs'], true))) return true;
        }
    } catch (Throwable) {}
    // 3. Fallback checking active session CURRENT_USER() host resolution
    try {
        $cu = (string)$p->query('SELECT CURRENT_USER()')->fetchColumn();
        if (str_contains($cu, '@')) {
            [$u, $h] = explode('@', $cu, 2);
            foreach (parse_grants($p, $u, $h) as $s) {
                if ($s['db'] === '*' && ($s['all'] || in_array('CREATE USER', $s['privs'], true) || in_array('SUPER', $s['privs'], true))) return true;
            }
        }
    } catch (Throwable) {}
    // 4. Fallback checking specific user@% if configured
    try {
        foreach (parse_grants($p, $c['user'], '%') as $s) {
            if ($s['db'] === '*' && ($s['all'] || in_array('CREATE USER', $s['privs'], true) || in_array('SUPER', $s['privs'], true))) return true;
        }
    } catch (Throwable) {}
    return false;
}

/** Ensure primary SQLite sandbox directory exists and return canonical realpaths of all allowed directories. */
function sqlite_allowed_dirs(): array {
    $cfg = fandejo_config();
    $out = [];
    foreach ($cfg['sqlite_dirs'] as $i => $d) {
        if ($i === 0 && !is_dir($d)) @mkdir($d, 0750, true);
        $real = realpath($d);
        if ($real !== false && is_dir($real)) $out[] = $real;
    }
    return array_values(array_unique($out));
}

/** Validate a database filename or relative entry and resolve it strictly inside the allowed SQLite sandbox directories. */
function resolve_sqlite_db(?string $name, bool $allowCreate = false): string {
    $dirs = sqlite_allowed_dirs();
    if (!$dirs) fail('No accessible SQLite sandbox directory configured');
    $name = trim((string)$name);
    if ($name === '' || $name === 'main') {
        $existing = list_sqlite_databases();
        if ($existing) return $existing[0]['path'];
        $name = 'main.sqlite';
        $allowCreate = true;
    }
    $dirIdx = 0;
    if (preg_match('/^@(\d+):(.*)$/', $name, $m)) {
        $dirIdx = (int)$m[1];
        $name = $m[2];
    }
    if (!isset($dirs[$dirIdx])) fail('Invalid SQLite directory index');
    $baseDir = $dirs[$dirIdx];
    if (str_contains($name, '/') || str_contains($name, '\\') || str_contains($name, '..') || str_contains($name, "\0")) {
        fail('Invalid SQLite database name (path traversal is not allowed)');
    }
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if ($ext === '') {
        foreach (SQLITE_EXTS as $tryExt) {
            if (is_file("$baseDir/$name.$tryExt")) { $name .= ".$tryExt"; $ext = $tryExt; break; }
        }
        if ($ext === '') { $name .= '.sqlite'; $ext = 'sqlite'; }
    }
    if (!in_array($ext, SQLITE_EXTS, true)) {
        fail('SQLite database must use .sqlite, .sqlite3, or .db extension');
    }
    $stem = pathinfo($name, PATHINFO_FILENAME);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $stem)) {
        fail('SQLite database name may only contain letters, numbers, dots, underscores, and hyphens');
    }
    $full = $baseDir . DIRECTORY_SEPARATOR . $name;
    if (is_file($full)) {
        $real = realpath($full);
        if ($real === false || dirname($real) !== $baseDir) fail('Access denied: outside SQLite sandbox directory');
        return $real;
    }
    if (!$allowCreate) {
        // Also check other allowed dirs if no explicit prefix was given
        foreach ($dirs as $d) {
            $alt = $d . DIRECTORY_SEPARATOR . $name;
            if (is_file($alt) && ($r = realpath($alt)) !== false && dirname($r) === $d) return $r;
        }
        fail("SQLite database '$name' not found in allowed sandbox directory");
    }
    return $full;
}

/** Scan all allowed SQLite sandbox directories and return database metadata rows. */
function list_sqlite_databases(): array {
    $dirs = sqlite_allowed_dirs();
    $multi = count($dirs) > 1;
    $out = [];
    foreach ($dirs as $idx => $dir) {
        $items = @scandir($dir) ?: [];
        foreach ($items as $f) {
            if ($f === '.' || $f === '..' || str_starts_with($f, '.')) continue;
            $full = $dir . DIRECTORY_SEPARATOR . $f;
            if (!is_file($full) || is_link($full)) continue;
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!in_array($ext, SQLITE_EXTS, true)) continue;
            $dbName = $multi && $idx > 0 ? "@$idx:$f" : $f;
            $tables = 0;
            try {
                $tp = new PDO('sqlite:' . $full, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                $tables = (int)$tp->query("SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")->fetchColumn();
            } catch (Throwable) {}
            $size = (int)@filesize($full);
            foreach (['-wal', '-shm'] as $suf) if (is_file($full . $suf)) $size += (int)@filesize($full . $suf);
            $out[] = [
                'name' => $dbName,
                'label' => $f,
                'dir' => $dir,
                'path' => $full,
                'tables' => $tables,
                'size' => $size,
                'charset' => 'UTF-8',
                'collation' => 'BINARY',
            ];
        }
    }
    usort($out, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    return $out;
}

function connect(array $c, ?string $db = null): PDO {
    $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
    if ($c['driver'] === 'sqlite') {
        $path = resolve_sqlite_db($db ?? ($c['db'] ?? ''), true);
        $pdo = new PDO('sqlite:' . $path, null, null, $opts);
        $pdo->exec('PRAGMA foreign_keys = ON');
        return $pdo;
    }
    if (!empty($c['socket'])) {
        $dsn = "mysql:unix_socket={$c['socket']};charset=utf8mb4" . ($db ? ";dbname=$db" : '');
    } else {
        $dsn = "mysql:host={$c['host']};port={$c['port']};charset=utf8mb4" . ($db ? ";dbname=$db" : '');
    }
    return new PDO($dsn, $c['user'], $c['pass'] ?? '', $opts);
}

function rows(PDO $p, string $sql, array $args = []): array { $s = $p->prepare($sql); $s->execute($args); return $s->fetchAll(); }

function format_byte_len(int $b): string {
    return $b < 1024 ? "{$b} B" : ($b < 1048576 ? round($b / 1024, 1) . ' KB' : round($b / 1048576, 1) . ' MB');
}

function run_sql(PDO $p, string $sql, int $maxRows = 1000): array {
    $maxRows = min(10000, max(10, $maxRows));
    $maxCellBytes = 65536; // 64 KB cell display cap
    $t = microtime(true);
    $s = $p->query($sql);
    $res = ['ms' => round((microtime(true) - $t) * 1000, 2)];
    $colCount = $s->columnCount();
    if ($colCount > 0) {
        $cols = [];
        for ($i = 0; $i < $colCount; $i++) {
            $cols[] = $s->getColumnMeta($i)['name'] ?? "col_$i";
        }
        $rows = [];
        $truncated = false;
        while (($row = $s->fetch(PDO::FETCH_NUM)) !== false) {
            if (count($rows) >= $maxRows) {
                $truncated = true;
                break;
            }
            $assoc = [];
            foreach ($cols as $idx => $cn) {
                $v = $row[$idx] ?? null;
                if (is_string($v) && $v !== '') {
                    $len = strlen($v);
                    if (str_contains($v, "\0") || !preg_match('//u', $v)) {
                        $hex = bin2hex(substr($v, 0, 16));
                        $v = '[BLOB ' . format_byte_len($len) . ' · 0x' . $hex . ($len > 16 ? '…' : '') . ']';
                    } elseif ($len > $maxCellBytes) {
                        $v = substr($v, 0, $maxCellBytes) . ' … [truncated ' . format_byte_len($len) . ']';
                    }
                }
                $assoc[$cn] = $v;
            }
            $rows[] = $assoc;
        }
        $s->closeCursor();
        $res['rows'] = $rows;
        $res['columns'] = $cols;
        $res['truncated'] = $truncated;
        $res['max_rows'] = $maxRows;
    } else {
        $res['affected'] = $s->rowCount();
    }
    return $res;
}


const PRIV_GLOBAL = ['SELECT','INSERT','UPDATE','DELETE','CREATE','DROP','REFERENCES','INDEX','ALTER','CREATE TEMPORARY TABLES','LOCK TABLES','CREATE VIEW','SHOW VIEW','CREATE ROUTINE','ALTER ROUTINE','EXECUTE','EVENT','TRIGGER','FILE','PROCESS','RELOAD','SHUTDOWN','SHOW DATABASES','SUPER','CREATE USER','REPLICATION SLAVE','REPLICATION CLIENT'];
const PRIV_DB = ['SELECT','INSERT','UPDATE','DELETE','CREATE','DROP','REFERENCES','INDEX','ALTER','CREATE TEMPORARY TABLES','LOCK TABLES','CREATE VIEW','SHOW VIEW','CREATE ROUTINE','ALTER ROUTINE','EXECUTE','EVENT','TRIGGER'];
const PRIV_TABLE = ['SELECT','INSERT','UPDATE','DELETE','CREATE','DROP','REFERENCES','INDEX','ALTER','CREATE VIEW','SHOW VIEW','TRIGGER'];
const DB_SYSTEM_USERS = ['mariadb.sys', 'mysql.sys', 'mysql.session', 'mysql.infoschema'];

function priv_catalog(string $db, string $tb): array {
    return $db === '*' ? PRIV_GLOBAL : ($tb === '*' ? PRIV_DB : PRIV_TABLE);
}
function unq(string $s): string { // `a``b` -> a`b ; \_ -> _
    if ($s === '*') return '*';
    $s = str_replace('``', '`', substr($s, 1, -1));
    return str_replace(['\\_', '\\%'], ['_', '%'], $s);
}
function scope_sql(string $db, string $tb): string {
    if ($db === '*') return '*.*';
    $d = '`' . str_replace(['`', '_', '%'], ['``', '\\_', '\\%'], $db) . '`';
    return $d . '.' . ($tb === '*' ? '*' : '`' . str_replace('`', '``', $tb) . '`');
}
function acct_sql(PDO $p, string $u, string $h): string { return $p->quote($u) . '@' . $p->quote($h); }

/** Parse SHOW GRANTS into [ ['db','table','privs'=>[], 'all'=>bool, 'option'=>bool, 'columns'=>[raw..]] ] */
function parse_grants(PDO $p, string $u, string $h): array {
    return parse_grant_lines(array_column($p->query('SHOW GRANTS FOR ' . acct_sql($p, $u, $h))->fetchAll(PDO::FETCH_NUM), 0));
}
function parse_grant_lines(array $lines): array {
    $out = [];
    $id = '(\*|`(?:[^`]|``)*`)';
    foreach ($lines as $g) {
        if (!preg_match('/^GRANT\s+(.+?)\s+ON\s+(?:(?:TABLE|FUNCTION|PROCEDURE)\s+)?' . $id . '\.' . $id . '\s+TO\s/s', $g, $m)) continue;
        $db = unq($m[2]); $tb = unq($m[3]);
        $k = "$db\0$tb";
        $out[$k] ??= ['db' => $db, 'table' => $tb, 'privs' => [], 'all' => false, 'option' => false, 'columns' => [], 'other' => []];
        $out[$k]['option'] = $out[$k]['option'] || (bool)preg_match('/WITH GRANT OPTION\s*$/i', $g) || (bool)preg_match('/\bWITH\b.*\bGRANT OPTION\b/i', $g);
        $parts = []; $buf = ''; $depth = 0;
        foreach (str_split($m[1]) as $ch) {
            if ($ch === '(') $depth++; if ($ch === ')') $depth--;
            if ($ch === ',' && !$depth) { $parts[] = trim($buf); $buf = ''; } else $buf .= $ch;
        }
        if (trim($buf) !== '') $parts[] = trim($buf);
        $cat = priv_catalog($db, $tb);
        foreach ($parts as $pt) {
            $up = strtoupper($pt);
            if ($up === 'ALL PRIVILEGES' || $up === 'ALL') { $out[$k]['all'] = true; $out[$k]['privs'] = array_values(array_unique(array_merge($out[$k]['privs'], $cat))); }
            elseif ($up === 'USAGE') continue;
            elseif (str_contains($pt, '(')) $out[$k]['columns'][] = $pt;
            elseif (in_array($up, $cat, true)) $out[$k]['privs'][] = $up;
            else $out[$k]['other'][] = $up;
        }
    }
    $list = array_values($out);
    usort($list, fn($a, $b) => [$a['db'] !== '*', $a['db'], $a['table'] !== '*', $a['table']] <=> [$b['db'] !== '*', $b['db'], $b['table'] !== '*', $b['table']]);
    foreach ($list as &$e) { $e['privs'] = array_values(array_unique($e['privs'])); $cat = priv_catalog($e['db'], $e['table']); $e['all'] = $e['all'] || ($e['privs'] && !array_diff($cat, $e['privs'])); }
    return $list;
}

const COL_TYPES = ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','DECIMAL','FLOAT','DOUBLE','BIT','BOOLEAN','DATE','TIME','DATETIME','TIMESTAMP','YEAR','CHAR','VARCHAR','BINARY','VARBINARY','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT','TINYBLOB','BLOB','MEDIUMBLOB','LONGBLOB','JSON','ENUM','SET','INTEGER','REAL','NUMERIC'];
const COL_NUMERIC = ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','DECIMAL','FLOAT','DOUBLE','INTEGER','REAL','NUMERIC'];
const COL_TEXT = ['CHAR','VARCHAR','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT','ENUM','SET'];

function parse_coltype(string $t): array {
    $o = ['base' => '', 'length' => '', 'values' => [], 'unsigned' => false];
    if (!preg_match('/^([a-z]+)(?:\((.*)\))?(.*)$/is', trim($t), $m)) return $o;
    $o['base'] = strtoupper($m[1]);
    $o['unsigned'] = str_contains(strtolower($m[3] ?? ''), 'unsigned');
    if (in_array($o['base'], ['ENUM', 'SET'], true)) {
        preg_match_all("/'((?:[^']|'')*)'/", $m[2] ?? '', $mm);
        $o['values'] = array_map(fn($v) => str_replace("''", "'", $v), $mm[1]);
    } else $o['length'] = $m[2] ?? '';
    return $o;
}
function parse_default(?string $d, bool $nullable, string $extra, bool $maria, string $drv): array {
    if ($drv === 'sqlite') {
        if ($d === null) return ['mode' => 'none', 'value' => ''];
        if (strtoupper($d) === 'NULL') return ['mode' => 'null', 'value' => ''];
        if (preg_match("/^'(.*)'$/s", $d, $m)) return ['mode' => 'value', 'value' => str_replace("''", "'", $m[1])];
        if (preg_match('/^\((.*)\)$/s', $d, $m)) return ['mode' => 'expr', 'value' => $m[1]];
        return is_numeric($d) ? ['mode' => 'value', 'value' => $d] : ['mode' => 'expr', 'value' => $d];
    }
    if ($d === null) return ['mode' => $nullable ? 'null' : 'none', 'value' => ''];
    if ($maria) {
        if (strtoupper($d) === 'NULL') return ['mode' => 'null', 'value' => ''];
        if (preg_match("/^'(.*)'$/s", $d, $m)) return ['mode' => 'value', 'value' => str_replace("''", "'", $m[1])];
        return is_numeric($d) ? ['mode' => 'value', 'value' => $d] : ['mode' => 'expr', 'value' => $d];
    }
    return str_contains($extra, 'DEFAULT_GENERATED') ? ['mode' => 'expr', 'value' => $d] : ['mode' => 'value', 'value' => $d];
}
/** Normalize default expression across MariaDB/MySQL and SQLite3. */
function norm_default_expr(string $e, string $drv): string {
    $e = trim($e);
    if (!preg_match('/^[A-Za-z_]+(\([\w\s,.\'-]*\))?$/', $e)) throw new InvalidArgumentException('Invalid default expression');
    if ($drv !== 'sqlite') return $e;
    $up = strtoupper($e);
    if (in_array($up, ['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'], true)) return $up;
    if ($up === 'NOW()') return 'CURRENT_TIMESTAMP';
    if ($up === 'CURDATE()') return 'CURRENT_DATE';
    if ($up === 'CURTIME()') return 'CURRENT_TIME';
    return str_contains($e, '(') ? "($e)" : $up;
}
/** Build a column definition (type + attributes) from request data. Throws on invalid input. */
function col_def(PDO $p, string $drv, array $in, bool $forAddColumn = false): string {
    $base = strtoupper(trim((string)($in['type'] ?? '')));
    if (!in_array($base, COL_TYPES, true)) throw new InvalidArgumentException("Unsupported type '$base'");
    $t = ($drv === 'sqlite' && in_array($base, ['ENUM', 'SET'], true)) ? 'TEXT' : $base;
    if ($drv === 'mysql' && in_array($base, ['ENUM', 'SET'], true)) {
        $vals = array_values(array_filter(array_map('strval', $in['values'] ?? []), fn($v) => $v !== ''));
        if (!$vals) throw new InvalidArgumentException("$base needs at least one value");
        $t .= '(' . implode(',', array_map(fn($v) => $p->quote($v), $vals)) . ')';
    } else {
        $len = trim((string)($in['length'] ?? ''));
        if ($len !== '' && !($drv === 'sqlite' && in_array($base, ['ENUM', 'SET'], true))) {
            if (!preg_match('/^\d+(,\d+)?$/', $len)) throw new InvalidArgumentException('Invalid length');
            $t .= "($len)";
        }
    }
    $d = $t;
    if ($drv === 'mysql' && !empty($in['unsigned']) && in_array($base, COL_NUMERIC, true)) $d .= ' UNSIGNED';
    $coll = trim((string)($in['collation'] ?? ''));
    if ($drv === 'mysql' && $coll !== '' && in_array($base, COL_TEXT, true)) {
        if (!preg_match('/^[a-z0-9]+_[a-z0-9_]+$/i', $coll)) throw new InvalidArgumentException('Invalid collation');
        $d .= ' CHARACTER SET ' . explode('_', $coll)[0] . ' COLLATE ' . $coll;
    }
    $mode = $in['default_mode'] ?? 'none';
    if ($drv === 'sqlite' && $forAddColumn && empty($in['null']) && in_array($mode, ['none', 'null'], true)) {
        throw new InvalidArgumentException('SQLite requires a non-NULL default value when adding a NOT NULL column to an existing table');
    }
    if ($drv === 'sqlite' && $forAddColumn && $mode === 'expr') {
        $ne = norm_default_expr((string)($in['default'] ?? ''), 'sqlite');
        if (str_starts_with($ne, '(')) throw new InvalidArgumentException('SQLite ADD COLUMN only allows constant defaults or CURRENT_TIMESTAMP / CURRENT_DATE / CURRENT_TIME');
    }
    $d .= empty($in['null']) ? ' NOT NULL' : ' NULL';
    if ($mode === 'null') $d .= ' DEFAULT NULL';
    elseif ($mode === 'value') $d .= ' DEFAULT ' . $p->quote((string)($in['default'] ?? ''));
    elseif ($mode === 'expr') {
        $d .= ' DEFAULT ' . norm_default_expr((string)($in['default'] ?? ''), $drv);
    }
    if ($drv === 'mysql' && !empty($in['on_update']) && in_array($base, ['DATETIME', 'TIMESTAMP'], true)) $d .= ' ON UPDATE CURRENT_TIMESTAMP';
    if ($drv === 'mysql' && !empty($in['ai'])) $d .= ' AUTO_INCREMENT';
    if ($drv === 'mysql' && trim((string)($in['comment'] ?? '')) !== '') $d .= ' COMMENT ' . $p->quote((string)$in['comment']);
    return $d;
}
function col_pos(string $drv, array $in): string {
    if ($drv !== 'mysql') return '';
    $a = (string)($in['after'] ?? '');
    return $a === '' ? '' : ($a === '__FIRST__' ? ' FIRST' : ' AFTER ' . q($a, $drv));
}

const FK_RULES = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'];
function col_list(string $drv, array $cols, bool $lengths = false): string {
    if (!$cols) throw new InvalidArgumentException('Pick at least one column');
    return '(' . implode(', ', array_map(function ($c) use ($drv, $lengths) {
        $c = is_array($c) ? $c : ['name' => $c];
        $n = trim((string)($c['name'] ?? '')); if ($n === '') throw new InvalidArgumentException('Column name missing');
        $len = trim((string)($c['length'] ?? ''));
        if ($len !== '' && !preg_match('/^\d+$/', $len)) throw new InvalidArgumentException('Invalid prefix length');
        return q($n, $drv) . ($lengths && $len !== '' && $drv === 'mysql' ? "($len)" : '');
    }, $cols)) . ')';
}
function list_indexes(PDO $p, string $drv, string $T, ?string $tb): array {
    $out = [];
    if ($drv === 'mysql') {
        foreach (rows($p, "SHOW INDEX FROM $T") as $r) {
            $k = $r['Key_name'];
            $out[$k] ??= ['name' => $k, 'unique' => !$r['Non_unique'], 'type' => $k === 'PRIMARY' ? 'PRIMARY' : (str_contains(strtoupper($r['Index_type']), 'FULLTEXT') ? 'FULLTEXT' : (str_contains(strtoupper($r['Index_type']), 'SPATIAL') ? 'SPATIAL' : (!$r['Non_unique'] ? 'UNIQUE' : 'INDEX'))), 'method' => $r['Index_type'], 'columns' => [], 'cardinality' => $r['Cardinality'], 'droppable' => true];
            $out[$k]['columns'][] = ['name' => $r['Column_name'], 'length' => $r['Sub_part'], 'desc' => ($r['Collation'] ?? 'A') === 'D'];
        }
    } else {
        $pk = array_values(array_map(fn($x) => ['name' => $x['name'], 'length' => null, 'desc' => false], array_filter(rows($p, 'PRAGMA table_info(' . q($tb, $drv) . ')'), fn($x) => $x['pk'] > 0)));
        if ($pk) $out['PRIMARY'] = ['name' => 'PRIMARY', 'unique' => true, 'type' => 'PRIMARY', 'method' => 'ROWID', 'columns' => $pk, 'cardinality' => null, 'droppable' => false];
        foreach (rows($p, 'PRAGMA index_list(' . q($tb, $drv) . ')') as $ix) {
            if ($ix['origin'] === 'pk') continue;
            $out[$ix['name']] = ['name' => $ix['name'], 'unique' => (bool)$ix['unique'], 'type' => $ix['unique'] ? 'UNIQUE' : 'INDEX', 'method' => 'BTREE', 'cardinality' => null, 'droppable' => $ix['origin'] === 'c',
                'columns' => array_map(fn($c) => ['name' => $c['name'], 'length' => null, 'desc' => false], rows($p, 'PRAGMA index_info(' . q($ix['name'], $drv) . ')'))];
        }
    }
    return array_values($out);
}

function list_fks(PDO $p, string $drv, ?string $db, ?string $tb): array {
    $out = [];
    if ($drv === 'mysql') {
        $rs = rows($p, "SELECT k.CONSTRAINT_NAME name, k.COLUMN_NAME col, k.REFERENCED_TABLE_SCHEMA rdb, k.REFERENCED_TABLE_NAME rt, k.REFERENCED_COLUMN_NAME rc, r.UPDATE_RULE ur, r.DELETE_RULE dr
            FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION", [$db, $tb]);
        foreach ($rs as $r) {
            $out[$r['name']] ??= ['name' => $r['name'], 'ref_db' => $r['rdb'], 'ref_table' => $r['rt'], 'on_update' => $r['ur'], 'on_delete' => $r['dr'], 'pairs' => [], 'droppable' => true];
            $out[$r['name']]['pairs'][] = ['col' => $r['col'], 'ref' => $r['rc']];
        }
    } else {
        foreach (rows($p, 'PRAGMA foreign_key_list(' . q($tb, $drv) . ')') as $r) {
            $k = 'fk_' . $r['id'];
            $out[$k] ??= ['name' => $k, 'ref_db' => null, 'ref_table' => $r['table'], 'on_update' => $r['on_update'], 'on_delete' => $r['on_delete'], 'pairs' => [], 'droppable' => false];
            $out[$k]['pairs'][] = ['col' => $r['from'], 'ref' => $r['to']];
        }
    }
    return array_values($out);
}

/** Find foreign keys on text columns involving $table (or all tables in $db when $table is null) and return [dropStmts, addStmts]. */
function fk_text_conversion_guards(PDO $p, string $db, ?string $table = null): array {
    $sql = "SELECT k.TABLE_SCHEMA sdb, k.TABLE_NAME stb, k.CONSTRAINT_NAME name, k.COLUMN_NAME col,
                   k.REFERENCED_TABLE_SCHEMA rdb, k.REFERENCED_TABLE_NAME rtb, k.REFERENCED_COLUMN_NAME rcol,
                   r.UPDATE_RULE ur, r.DELETE_RULE dr, c1.CHARACTER_SET_NAME cs1, c2.CHARACTER_SET_NAME cs2
            FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
            JOIN information_schema.COLUMNS c1
              ON c1.TABLE_SCHEMA = k.TABLE_SCHEMA AND c1.TABLE_NAME = k.TABLE_NAME AND c1.COLUMN_NAME = k.COLUMN_NAME
            JOIN information_schema.COLUMNS c2
              ON c2.TABLE_SCHEMA = k.REFERENCED_TABLE_SCHEMA AND c2.TABLE_NAME = k.REFERENCED_TABLE_NAME AND c2.COLUMN_NAME = k.REFERENCED_COLUMN_NAME
            WHERE (k.TABLE_SCHEMA = ? OR k.REFERENCED_TABLE_SCHEMA = ?) AND k.REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION";
    $fks = [];
    foreach (rows($p, $sql, [$db, $db]) as $r) {
        if ($r['cs1'] === null && $r['cs2'] === null) continue; // numeric/date FK — unaffected by charset conversion
        if ($table !== null && !(($r['sdb'] === $db && $r['stb'] === $table) || ($r['rdb'] === $db && $r['rtb'] === $table))) continue;
        $key = $r['sdb'] . '.' . $r['stb'] . '.' . $r['name'];
        $fks[$key] ??= ['sdb' => $r['sdb'], 'stb' => $r['stb'], 'name' => $r['name'], 'rdb' => $r['rdb'], 'rtb' => $r['rtb'], 'ur' => $r['ur'], 'dr' => $r['dr'], 'cols' => [], 'refs' => []];
        $fks[$key]['cols'][] = $r['col'];
        $fks[$key]['refs'][] = $r['rcol'];
    }
    $drops = []; $adds = [];
    foreach ($fks as $f) {
        $ST = q($f['sdb'], 'mysql') . '.' . q($f['stb'], 'mysql');
        $RT = q($f['rdb'], 'mysql') . '.' . q($f['rtb'], 'mysql');
        $drops[] = "ALTER TABLE $ST DROP FOREIGN KEY " . q($f['name'], 'mysql');
        $adds[] = "ALTER TABLE $ST ADD CONSTRAINT " . q($f['name'], 'mysql') . ' FOREIGN KEY ' . col_list('mysql', $f['cols'])
            . " REFERENCES $RT " . col_list('mysql', $f['refs']) . " ON DELETE {$f['dr']} ON UPDATE {$f['ur']}";
    }
    return [$drops, $adds];
}

/** Build two-step MODIFY via BINARY statements for a table to fix UTF-8 bytes stored inside latin1 columns without double-encoding. */
function binary_relabel_table_sql(PDO $p, string $db, string $tb, string $cs, string $coll): array {
    $T = q($db, 'mysql') . '.' . q($tb, 'mysql');
    $maria = stripos((string)$p->query('SELECT VERSION()')->fetchColumn(), 'mariadb') !== false;
    $binMap = ['CHAR' => 'BINARY', 'VARCHAR' => 'VARBINARY', 'TINYTEXT' => 'TINYBLOB', 'TEXT' => 'BLOB', 'MEDIUMTEXT' => 'MEDIUMBLOB', 'LONGTEXT' => 'LONGBLOB'];
    $step1 = []; $step2 = [];
    foreach (rows($p, "SHOW FULL COLUMNS FROM $T") as $x) {
        $pt = parse_coltype($x['Type']);
        if (!isset($binMap[$pt['base']])) continue;
        $bType = $binMap[$pt['base']] . ($pt['length'] !== '' ? "({$pt['length']})" : '');
        $nullSql = $x['Null'] === 'YES' ? ' NULL' : ' NOT NULL';
        $def = parse_default($x['Default'], $x['Null'] === 'YES', $x['Extra'], $maria, 'mysql');
        $defSql = $def['mode'] === 'null' ? ' DEFAULT NULL' : ($def['mode'] === 'value' ? ' DEFAULT ' . $p->quote($def['value']) : ($def['mode'] === 'expr' ? " DEFAULT {$def['value']}" : ''));
        $cmtSql = ($x['Comment'] ?? '') !== '' ? ' COMMENT ' . $p->quote($x['Comment']) : '';
        $step1[] = 'MODIFY ' . q($x['Field'], 'mysql') . " $bType$nullSql";
        $step2[] = 'MODIFY ' . q($x['Field'], 'mysql') . " {$x['Type']} CHARACTER SET $cs COLLATE $coll$nullSql$defSql$cmtSql";
    }
    $out = [];
    if ($step1) $out[] = "ALTER TABLE $T " . implode(', ', $step1);
    $out[] = "ALTER TABLE $T DEFAULT CHARACTER SET $cs COLLATE $coll" . ($step2 ? ', ' . implode(', ', $step2) : '');
    return $out;
}

function table_cols(PDO $p, string $drv, string $T, ?string $tb): array {
    return array_column(rows($p, $drv === 'sqlite' ? 'PRAGMA table_info(' . q((string)$tb, $drv) . ')' : "SHOW COLUMNS FROM $T"), $drv === 'sqlite' ? 'name' : 'Field');
}
/** WHERE / ORDER BY for the table browser search, column filters, and sort; fills $args. */
function filter_sql(string $drv, array $cols, array $in, array &$args): array {
    $clauses = []; $args = [];
    if (($in['search'] ?? '') !== '') {
        $parts = [];
        foreach ($cols as $col) { $parts[] = 'CAST(' . q($col, $drv) . ' AS ' . ($drv === 'mysql' ? 'CHAR' : 'TEXT') . ') LIKE ?'; $args[] = '%' . $in['search'] . '%'; }
        if ($parts) $clauses[] = '(' . implode(' OR ', $parts) . ')';
    }
    if (!empty($in['filters']) && is_array($in['filters'])) {
        foreach ($in['filters'] as $f) {
            if (!is_array($f)) continue;
            $col = (string)($f['col'] ?? '');
            if (!in_array($col, $cols, true)) continue;
            $op = strtoupper(trim((string)($f['op'] ?? '=')));
            $val = (string)($f['val'] ?? '');
            $qc = q($col, $drv);
            switch ($op) {
                case '=':
                case '!=':
                case '<':
                case '<=':
                case '>':
                case '>=':
                    $clauses[] = "$qc $op ?";
                    $args[] = $val;
                    break;
                case 'LIKE':
                case 'NOT LIKE':
                    $clauses[] = "$qc $op ?";
                    $args[] = $val;
                    break;
                case 'CONTAINS':
                    $clauses[] = "$qc LIKE ?";
                    $args[] = "%$val%";
                    break;
                case 'STARTS':
                    $clauses[] = "$qc LIKE ?";
                    $args[] = "$val%";
                    break;
                case 'ENDS':
                    $clauses[] = "$qc LIKE ?";
                    $args[] = "%$val";
                    break;
                case 'IN':
                case 'NOT IN':
                    $items = array_values(array_filter(array_map('trim', explode(',', $val)), fn($x) => $x !== ''));
                    if ($items) {
                        $ph = implode(',', array_fill(0, count($items), '?'));
                        $clauses[] = "$qc $op ($ph)";
                        array_push($args, ...$items);
                    }
                    break;
                case 'IS NULL':
                case 'IS NOT NULL':
                    $clauses[] = "$qc $op";
                    break;
                case 'EMPTY':
                    $clauses[] = "$qc = ''";
                    break;
                case 'NOT EMPTY':
                    $clauses[] = "($qc IS NOT NULL AND $qc != '')";
                    break;
            }
        }
    }
    $where = $clauses ? ' WHERE ' . implode(' AND ', $clauses) : '';
    $order = (!empty($in['sort']) && in_array($in['sort'], $cols, true)) ? ' ORDER BY ' . q($in['sort'], $drv) . (($in['dir'] ?? '') === 'desc' ? ' DESC' : ' ASC') : '';
    return [$where, $order];
}

/** Build a single-file PKZIP archive in pure PHP (using zlib raw deflate, no ext-zip required). */
function build_single_file_zip(string $entryName, string $content): string {
    $crc = crc32($content);
    $uLen = strlen($content);
    $comp = gzdeflate($content, 6);
    $cLen = strlen($comp);
    $fnLen = strlen($entryName);
    $localHdr = pack('VvvvvvVVVvv', 0x04034b50, 20, 0, 8, 0, 0, $crc, $cLen, $uLen, $fnLen, 0) . $entryName;
    $cdOffset = strlen($localHdr) + $cLen;
    $cdHdr = pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0, 8, 0, 0, $crc, $cLen, $uLen, $fnLen, 0, 0, 0, 0, 0, 0) . $entryName;
    $eocd = pack('VvvvvVVv', 0x06054b50, 0, 0, 1, 1, strlen($cdHdr), $cdOffset, 0);
    return $localHdr . $comp . $cdHdr . $eocd;
}

/** Extract the first file from a raw Gzip (.gz), PKZIP (.zip), or plain text payload. */
function decode_archive_payload(string $raw, string $filename = ''): string {
    // 1. Check Gzip magic bytes (\x1f\x8b)
    if (str_starts_with($raw, "\x1f\x8b")) {
        $dec = @gzdecode($raw);
        if ($dec === false) fail('Failed to decompress Gzip (.gz) file');
        return $dec;
    }
    // 2. Check PKZIP magic bytes (PK\x03\x04)
    if (str_starts_with($raw, "PK\x03\x04")) {
        if (strlen($raw) < 30) fail('Invalid or truncated ZIP archive');
        $hdr = unpack('Vsig/vver/vflag/vmeth/vmtime/vmdate/Vcrc/Vcsize/Vusize/vfnlen/vexlen', substr($raw, 0, 30));
        $dataOffset = 30 + $hdr['fnlen'] + $hdr['exlen'];
        $csize = $hdr['csize'];
        // If bit 3 (data descriptor) is set and local header csize is 0, read sizes from Central Directory
        if ($csize === 0 && ($hdr['flag'] & 8)) {
            $cdPos = strpos($raw, "PK\x01\x02");
            if ($cdPos !== false && strlen($raw) >= $cdPos + 46) {
                $cd = unpack('Vsig/vver/vver2/vflag/vmeth/vmtime/vmdate/Vcrc/Vcsize/Vusize', substr($raw, $cdPos, 28));
                $csize = $cd['csize'];
            }
        }
        $compData = substr($raw, $dataOffset, $csize);
        if ($hdr['meth'] === 0) return $compData; // STORED
        if ($hdr['meth'] === 8) {                 // DEFLATED
            $dec = @gzinflate($compData);
            if ($dec === false) fail('Failed to inflate entry inside ZIP archive');
            return $dec;
        }
        fail("Unsupported ZIP compression method ({$hdr['meth']}); use standard Deflate or Store");
    }
    return $raw;
}

/** Split a SQL script into individual statements outside quotes and comments. */
function split_sql_statements(string $sql, string $drv): array {
    if (str_starts_with($sql, "\xEF\xBB\xBF")) $sql = substr($sql, 3);
    $stmts = []; $buf = ''; $qt = null;
    for ($i = 0, $n = strlen($sql); $i < $n; $i++) {
        $ch = $sql[$i];
        if ($qt) {
            if ($ch === '\\' && $qt !== '`' && $drv === 'mysql') { $buf .= $ch . ($sql[++$i] ?? ''); continue; }
            if ($ch === $qt) {
                if (($qt === "'" || $qt === '"' || $qt === '`') && ($sql[$i + 1] ?? '') === $qt) { $buf .= $ch . $sql[++$i]; continue; }
                $qt = null;
            }
            $buf .= $ch;
            continue;
        }
        if ($ch === '-' && ($sql[$i + 1] ?? '') === '-') {
            $nl = strpos($sql, "\n", $i + 2);
            if ($nl === false) break;
            $buf .= "\n"; $i = $nl; continue;
        }
        if ($ch === '#' && $drv === 'mysql') {
            $nl = strpos($sql, "\n", $i + 1);
            if ($nl === false) break;
            $buf .= "\n"; $i = $nl; continue;
        }
        if ($ch === '/' && ($sql[$i + 1] ?? '') === '*') {
            $end = strpos($sql, '*/', $i + 2);
            if ($end === false) break;
            $i = $end + 1; continue;
        }
        if ($ch === "'" || $ch === '"' || $ch === '`') $qt = $ch;
        elseif ($ch === ';') { if (trim($buf) !== '') $stmts[] = $buf; $buf = ''; continue; }
        $buf .= $ch;
    }
    if (trim($buf) !== '') $stmts[] = $buf;
    return $stmts;
}

$rawBody = file_get_contents('php://input') ?: '';
$in = (!empty($_POST) && empty($rawBody)) ? $_POST : (json_decode($rawBody ?: '{}', true) ?: []);
$a = $_GET['a'] ?? '';

if ($a === 'session') {
    $cfg = fandejo_config();
    $ok = isset($_SESSION['c']['sealed_pass']) && open_secret($_SESSION['c']['sealed_pass']) !== null;
    if ($ok) {
        $now = time();
        $fp = session_fingerprint();
        if ((!empty($_SESSION['c']['fp']) && !hash_equals($_SESSION['c']['fp'], $fp))
            || (!empty($_SESSION['c']['last_active']) && ($now - $_SESSION['c']['last_active']) > $cfg['session_idle_ttl'])) {
            clear_auth();
            $ok = false;
        } else {
            $_SESSION['c']['last_active'] = $now;
        }
    }
    if (!$ok) {
        $sso = FandejoCpanelBridge::attemptSocketSSO();
        if ($sso !== null) {
            $c = [
                'driver' => 'mysql',
                'host' => 'localhost',
                'port' => 3306,
                'user' => $sso['user'],
                'socket' => $sso['socket'],
                'db' => '',
                'sealed_pass' => seal_secret(''),
                'fp' => session_fingerprint(),
                'created_at' => time(),
                'last_active' => time(),
            ];
            $_SESSION['c'] = $c;
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            $ok = true;
        }
    }
    if (!$ok && isset($_SESSION['c'])) clear_auth();
    out([
        'auth' => $ok,
        'version' => fandejo_version(),
        'driver' => $ok ? $_SESSION['c']['driver'] : null,
        'user' => $ok ? $_SESSION['c']['user'] : null,
        'sqlite_setup' => empty($cfg['sqlite_users']),
        'sqlite_dirs' => sqlite_allowed_dirs(),
        'max_login_attempts' => $cfg['max_login_attempts'],
        'session_idle_ttl' => $cfg['session_idle_ttl'],
    ]);
}
if ($a === 'login') {
    $drvIn = ($in['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    $c = ['driver' => $drvIn,
          'host' => $in['host'] ?? '127.0.0.1', 'port' => (int)($in['port'] ?? 3306),
          'user' => trim((string)($in['user'] ?? '')), 'pass' => (string)($in['pass'] ?? ''), 'db' => $in['db'] ?? ''];
    $mustBeAdmin = $c['user'] !== '' ? check_login_lock($drvIn, $c['user']) : false;
    if ($drvIn === 'sqlite') {
        $cfg = fandejo_config();
        if ($c['user'] === '' || $c['pass'] === '') fail('Username and password are required for SQLite access', 401);
        if (empty($cfg['sqlite_users'])) {
            if (!empty($in['setup_sqlite'])) {
                if (strlen($c['pass']) < 6) fail('Password must be at least 6 characters', 400);
                $hash = password_hash($c['pass'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
                save_sqlite_config($cfg['sqlite_dirs'], [$c['user'] => $hash]);
            } else {
                fail('SQLite authentication is not configured yet. Enable initial setup or configure sqlite_users in config.php.', 401);
            }
        } else {
            $hash = $cfg['sqlite_users'][$c['user']] ?? null;
            if (!$hash || !password_verify($c['pass'], $hash)) {
                record_login_failure('sqlite', $c['user'], 'Invalid SQLite username or password');
            }
        }
        sqlite_allowed_dirs();
    } else {
        if ($c['user'] === '') fail('Username is required', 401);
        try { $pdoLogin = connect($c); } catch (Throwable $e) {
            record_login_failure('mysql', $c['user'], $e->getMessage());
        }
        // If this login was permitted only via the admin cooldown self-recovery window, verify the account is a full admin
        if ($mustBeAdmin && !is_full_admin($pdoLogin, 'mysql', $c)) {
            fail("Account '{$c['user']}' remains locked. Only an administrator with full privileges can self-unlock after the cooldown period.", 423);
        }
    }
    clear_login_failures($drvIn, $c['user']);
    session_regenerate_id(true);
    $sealed = seal_secret($c['pass']);
    unset($c['pass']);
    $c['sealed_pass'] = $sealed;
    $c['fp'] = session_fingerprint();
    $c['created_at'] = time();
    $c['last_active'] = time();
    $_SESSION['c'] = $c;
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}
if (!isset($_SESSION['c']['sealed_pass'])) {
    $sso = FandejoCpanelBridge::attemptSocketSSO();
    if ($sso !== null) {
        $c = [
            'driver' => 'mysql',
            'host' => 'localhost',
            'port' => 3306,
            'user' => $sso['user'],
            'socket' => $sso['socket'],
            'db' => '',
            'sealed_pass' => seal_secret(''),
            'fp' => session_fingerprint(),
            'created_at' => time(),
            'last_active' => time(),
        ];
        $_SESSION['c'] = $c;
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    } else {
        fail('Not authenticated', 401);
    }
}
if ($a === 'logout') { clear_auth(); out(['ok' => true]); }

$cfg = fandejo_config();
$now = time();
if (!empty($_SESSION['c']['fp']) && !hash_equals($_SESSION['c']['fp'], session_fingerprint())) {
    clear_auth();
    fail('Session security fingerprint mismatch; please sign in again', 401);
}
if (!empty($_SESSION['c']['last_active']) && ($now - $_SESSION['c']['last_active']) > $cfg['session_idle_ttl']) {
    clear_auth();
    fail('Session expired due to inactivity; please sign in again', 401);
}
$_SESSION['c']['last_active'] = $now;

if ($a === 'csrf') out(['csrf' => $_SESSION['csrf']]);
if (($_SERVER['HTTP_X_CSRF'] ?? '') !== $_SESSION['csrf']) fail('Bad CSRF token', 403);

$c = $_SESSION['c'];
$plainPass = open_secret($c['sealed_pass']);
if ($plainPass === null) { clear_auth(); fail('Session key missing or expired; please sign in again', 401); }
$c['pass'] = $plainPass;
$drv = $c['driver'];
$db = $in['db'] ?? ($_GET['db'] ?? null);
$tb = $in['table'] ?? ($_GET['table'] ?? null);

try {
    $noConnectActions = ['databases', 'create_db', 'drop_db', 'server_info', 'server_meta', 'change_own_password', 'sqlite_dirs', 'set_sqlite_dirs', 'users', 'create_user', 'drop_user', 'set_password', 'lockouts', 'unlock_account'];
    $p = ($drv === 'sqlite' && in_array($a, $noConnectActions, true)) ? null : connect($c, $db);
    $T = $tb !== null ? ($drv === 'mysql' ? q((string)$db, $drv) . '.' : '') . q((string)$tb, $drv) : '';

    switch ($a) {
    case 'sqlite_dirs':
        if ($drv !== 'sqlite') fail('SQLite mode only');
        $cfg = fandejo_config();
        $out = [];
        foreach ($cfg['sqlite_dirs'] as $d) {
            $real = realpath($d);
            $exists = $real !== false && is_dir($real);
            $pdir = $exists ? $real : $d;
            $files = 0;
            if ($exists) {
                foreach (@scandir($real) ?: [] as $f) {
                    if ($f !== '.' && $f !== '..' && !str_starts_with($f, '.') && is_file("$real/$f") && in_array(strtolower(pathinfo($f, PATHINFO_EXTENSION)), SQLITE_EXTS, true)) {
                        $files++;
                    }
                }
            }
            $out[] = [
                'path' => $pdir,
                'exists' => $exists,
                'readable' => $exists && is_readable($real),
                'writable' => $exists && is_writable($real),
                'files' => $files,
            ];
        }
        out(['dirs' => $out, 'base_root' => realpath($cfg['sqlite_base_root']) ?: $cfg['sqlite_base_root'], 'allow_any_dir' => $cfg['sqlite_allow_any_dir']]);

    case 'set_sqlite_dirs':
        if ($drv !== 'sqlite') fail('SQLite mode only');
        $cfg = fandejo_config();
        $rawDirs = $in['dirs'] ?? [];
        if (!is_array($rawDirs)) fail('Invalid directory list');
        $createMissing = !empty($in['create_missing']);
        $allowedRoots = array_values(array_filter(array_unique(array_merge(
            [realpath($cfg['sqlite_base_root']) ?: $cfg['sqlite_base_root']],
            array_map(fn($d) => realpath($d) ?: $d, $cfg['sqlite_dirs'])
        ))));
        $forbiddenExact = ['/', '/etc', '/bin', '/sbin', '/usr', '/lib', '/lib64', '/proc', '/sys', '/dev', '/boot', '/root', realpath(__DIR__) ?: __DIR__];
        $clean = [];
        foreach ($rawDirs as $d) {
            $d = rtrim(trim((string)$d), '/\\');
            if ($d === '') continue;
            if (str_contains($d, "\0") || preg_match('#(^|/)\.\.(/|$)#', $d)) fail('Invalid directory path (path traversal is not allowed)');
            if (!str_starts_with($d, '/')) {
                $d = ($allowedRoots[0] ?? dirname(__DIR__)) . '/' . ltrim($d, '/');
            }
            if (!$cfg['sqlite_allow_any_dir']) {
                $underAllowed = false;
                foreach ($allowedRoots as $root) {
                    if ($d === $root || str_starts_with($d, rtrim($root, '/') . '/')) { $underAllowed = true; break; }
                }
                if (!$underAllowed) {
                    fail("Directory '$d' is outside the allowed project sandbox ({$allowedRoots[0]}). Add external directories directly in config.php or set 'sqlite_allow_any_dir' => true.");
                }
            }
            if (!is_dir($d)) {
                if ($createMissing) {
                    if (!@mkdir($d, 0750, true)) fail("Could not create directory '$d' — check filesystem permissions");
                } else {
                    fail("Directory '$d' does not exist (enable 'Create missing directories' or create it first)");
                }
            }
            $real = realpath($d);
            if ($real === false || !is_dir($real)) fail("Unable to resolve directory '$d'");
            if (in_array($real, $forbiddenExact, true)) fail("Directory '$real' cannot be used as an SQLite data directory");
            if (!$cfg['sqlite_allow_any_dir']) {
                $realAllowed = false;
                foreach ($allowedRoots as $root) {
                    if ($real === $root || str_starts_with($real, rtrim($root, '/') . '/')) { $realAllowed = true; break; }
                }
                if (!$realAllowed) fail("Resolved directory '$real' is outside the allowed project sandbox");
            }
            if (!is_readable($real)) fail("Directory '$real' is not readable by PHP user (" . get_current_user() . ")");
            $clean[] = $real;
        }
        $clean = array_values(array_unique($clean));
        if (!$clean) fail('At least one allowed SQLite directory is required');
        save_sqlite_config($clean, $cfg['sqlite_users']);
        out(['ok' => true, 'dirs' => $clean]);
    case 'server_info':
        $info = [
            'version' => fandejo_version(),
            'driver' => $drv,
            'php_version' => PHP_VERSION,
            'php_sapi' => PHP_SAPI,
            'os' => php_uname('s') . ' ' . php_uname('r') . ' (' . php_uname('m') . ')',
            'extensions' => array_values(array_intersect(['PDO', 'pdo_mysql', 'pdo_sqlite', 'mysqli', 'sqlite3', 'sodium', 'json', 'mbstring', 'openssl', 'zlib'], get_loaded_extensions())),
            'memory_limit' => ini_get('memory_limit'),
            'upload_max_filesize' => ini_get('upload_max_filesize'),
            'is_admin' => is_full_admin($p, $drv, $c),
            'max_login_attempts' => $cfg['max_login_attempts'],
            'session_idle_ttl' => $cfg['session_idle_ttl'],
        ];
        if ($info['is_admin']) {
            $locks = load_locks();
            $lockedCount = count(array_filter($locks['accounts'] ?? [], fn($a) => !empty($a['locked'])));
            $info['locked_accounts_count'] = $lockedCount;
        }
        if ($drv === 'mysql') {
            $ver = (string)$p->query('SELECT VERSION()')->fetchColumn();
            $cu = (string)$p->query('SELECT CURRENT_USER()')->fetchColumn();
            $u = (string)$p->query('SELECT USER()')->fetchColumn();
            $vars = [];
            foreach (rows($p, "SHOW VARIABLES WHERE Variable_name IN ('character_set_server','collation_server','max_connections','port','socket','datadir','version_comment','innodb_buffer_pool_size')") as $r) {
                $vars[$r['Variable_name']] = $r['Value'];
            }
            $stat = [];
            foreach (rows($p, "SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime','Threads_connected','Questions','Slow_queries','Bytes_received','Bytes_sent')") as $r) {
                $stat[$r['Variable_name']] = $r['Value'];
            }
            $at = strrpos($cu, '@');
            $myUser = $at !== false ? substr($cu, 0, $at) : $c['user'];
            $myHost = $at !== false ? substr($cu, $at + 1) : 'localhost';
            $info += [
                'server_name' => (stripos($ver, 'mariadb') !== false ? 'MariaDB' : 'MySQL'),
                'server_version' => $ver,
                'version_comment' => $vars['version_comment'] ?? '',
                'host' => $c['host'] . ':' . $c['port'],
                'user' => $u,
                'current_user' => $cu,
                'my_user' => $myUser,
                'my_host' => $myHost,
                'charset' => ($vars['character_set_server'] ?? 'utf8mb4') . ' (' . ($vars['collation_server'] ?? '') . ')',
                'default_collation' => $vars['collation_server'] ?? 'utf8mb4_unicode_ci',
                'datadir' => $vars['datadir'] ?? '',
                'socket' => $vars['socket'] ?? '',
                'max_connections' => (int)($vars['max_connections'] ?? 0),
                'uptime' => (int)($stat['Uptime'] ?? 0),
                'threads' => (int)($stat['Threads_connected'] ?? 0),
                'questions' => (int)($stat['Questions'] ?? 0),
                'slow_queries' => (int)($stat['Slow_queries'] ?? 0),
            ];
        } else {
            $sp = new PDO('sqlite::memory:');
            $ver = (string)$sp->query('SELECT sqlite_version()')->fetchColumn();
            $dirs = sqlite_allowed_dirs();
            $dbs = list_sqlite_databases();
            $info += [
                'server_name' => 'SQLite',
                'server_version' => $ver,
                'host' => implode(', ', $dirs),
                'datadir' => $dirs[0] ?? '',
                'sqlite_dirs' => $dirs,
                'user' => $c['user'] . '@fandejo-config',
                'current_user' => $c['user'] . '@sqlite-sandbox',
                'my_user' => $c['user'],
                'my_host' => 'sqlite-sandbox',
                'charset' => (string)$sp->query('PRAGMA encoding')->fetchColumn(),
                'file_size' => array_sum(array_column($dbs, 'size')),
                'journal_mode' => 'WAL',
                'foreign_keys_on' => true,
            ];
        }
        out($info);

    case 'change_own_password':
        if (($in['pass'] ?? '') === '') fail('Password required');
        if ($drv === 'sqlite') {
            if (strlen((string)$in['pass']) < 6) fail('Password must be at least 6 characters');
            $cfg = fandejo_config();
            $users = $cfg['sqlite_users'];
            $users[$c['user']] = password_hash((string)$in['pass'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
            save_sqlite_config($cfg['sqlite_dirs'], $users);
            $_SESSION['c']['sealed_pass'] = seal_secret((string)$in['pass']);
            out(['ok' => true]);
        }
        $cu = (string)$p->query('SELECT CURRENT_USER()')->fetchColumn();
        $at = strrpos($cu, '@');
        $u = $at !== false ? substr($cu, 0, $at) : $c['user'];
        $h = $at !== false ? substr($cu, $at + 1) : 'localhost';
        $p->exec('ALTER USER ' . acct_sql($p, $u, $h) . ' IDENTIFIED BY ' . $p->quote($in['pass']));
        $_SESSION['c']['sealed_pass'] = seal_secret((string)$in['pass']);
        out(['ok' => true]);

    case 'databases':
        if ($drv === 'sqlite') out(['databases' => list_sqlite_databases()]);
        $r = rows($p, "SELECT s.SCHEMA_NAME name, s.DEFAULT_CHARACTER_SET_NAME charset, s.DEFAULT_COLLATION_NAME collation, COUNT(t.TABLE_NAME) tables, COALESCE(SUM(t.DATA_LENGTH+t.INDEX_LENGTH),0) size
                       FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=s.SCHEMA_NAME GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME ORDER BY 1");
        out(['databases' => $r]);

    case 'server_meta':
        if ($drv !== 'mysql') out(['engines' => [], 'collations' => [], 'default_engine' => '', 'default_collation' => '']);
        $engs = []; $defEng = 'InnoDB';
        foreach (rows($p, 'SHOW ENGINES') as $e) {
            if (in_array(strtoupper($e['Support'] ?? ''), ['YES', 'DEFAULT'], true) && !in_array(strtoupper($e['Engine']), ['PERFORMANCE_SCHEMA'], true)) {
                $engs[] = $e['Engine'];
                if (strtoupper($e['Support']) === 'DEFAULT') $defEng = $e['Engine'];
            }
        }
        $colls = [];
        foreach (rows($p, 'SHOW COLLATION') as $cl) {
            $cs = $cl['Charset'];
            if (in_array($cs, ['utf8mb4', 'utf8mb3', 'utf8', 'latin1', 'ascii', 'binary'], true)) {
                $colls[$cs][] = $cl['Collation'];
            }
        }
        foreach ($colls as &$list) sort($list);
        $defColl = (string)$p->query("SELECT @@collation_server")->fetchColumn() ?: 'utf8mb4_unicode_ci';
        out(['engines' => $engs, 'collations' => $colls, 'default_engine' => $defEng, 'default_collation' => $defColl]);

    case 'create_db':
        if ($drv === 'sqlite') {
            $rawName = trim((string)($in['name'] ?? ''));
            if ($rawName === '') fail('Database name required');
            $path = resolve_sqlite_db($rawName, true);
            if (is_file($path)) fail('SQLite database file already exists');
            $np = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $np->exec('PRAGMA journal_mode=WAL; PRAGMA encoding="UTF-8";');
            $np = null;
            out(['ok' => true, 'name' => basename($path)]);
        }
        $coll = trim((string)($in['collation'] ?? 'utf8mb4_unicode_ci'));
        if ($coll !== '' && !preg_match('/^[a-z0-9]+_[a-z0-9_]+$/i', $coll)) fail('Invalid collation');
        $cs = $coll !== '' ? explode('_', $coll)[0] : 'utf8mb4';
        $p->exec('CREATE DATABASE ' . q($in['name'], $drv) . " CHARACTER SET $cs" . ($coll !== '' ? " COLLATE $coll" : ''));
        out(['ok' => true, 'name' => $in['name']]);

    case 'alter_db':
        if ($drv !== 'mysql') fail('MySQL/MariaDB only');
        $coll = trim((string)($in['collation'] ?? ''));
        if (!preg_match('/^[a-z0-9]+_[a-z0-9_]+$/i', $coll)) fail('Invalid collation');
        $cs = explode('_', $coll)[0];
        $mode = $in['mode'] ?? (!empty($in['convert_all']) ? 'convert' : 'db_only'); // db_only | table_defaults | convert | binary
        $stmts = ['ALTER DATABASE ' . q((string)$db, $drv) . " CHARACTER SET $cs COLLATE $coll"];
        $tblCount = 0; $fkDrops = []; $fkAdds = [];
        if ($mode !== 'db_only') {
            $tbls = rows($p, "SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1", [$db]);
            $tblCount = count($tbls);
            if (in_array($mode, ['convert', 'binary'], true) && $tblCount > 0) {
                [$fkDrops, $fkAdds] = fk_text_conversion_guards($p, (string)$db, null);
                array_push($stmts, ...$fkDrops);
            }
            foreach ($tbls as $t) {
                $QT = q((string)$db, $drv) . '.' . q($t['name'], $drv);
                if ($mode === 'table_defaults') {
                    $stmts[] = "ALTER TABLE $QT DEFAULT CHARACTER SET $cs COLLATE $coll";
                } elseif ($mode === 'binary') {
                    array_push($stmts, ...binary_relabel_table_sql($p, (string)$db, $t['name'], $cs, $coll));
                } else {
                    $stmts[] = "ALTER TABLE $QT CONVERT TO CHARACTER SET $cs COLLATE $coll";
                }
            }
            if ($fkAdds) array_push($stmts, ...$fkAdds);
        }
        $warnings = [];
        if (empty($in['dry'])) {
            if ($tblCount > 0) $p->exec('SET FOREIGN_KEY_CHECKS=0');
            try {
                foreach ($stmts as $s) {
                    try { $p->exec($s); }
                    catch (Throwable $e) {
                        if (str_starts_with($s, 'ALTER DATABASE')) throw $e;
                        $warnings[] = $e->getMessage() . " [$s]";
                    }
                }
            } finally {
                if ($tblCount > 0) $p->exec('SET FOREIGN_KEY_CHECKS=1');
            }
        }
        out(['ok' => true, 'statements' => $stmts, 'converted_tables' => $tblCount, 'fk_guards' => count($fkDrops), 'warnings' => $warnings]);

    case 'drop_db':
        if ($drv === 'sqlite') {
            $path = resolve_sqlite_db((string)$db, false);
            if (!@unlink($path)) fail('Unable to delete SQLite database file');
            foreach (['-wal', '-shm', '-journal'] as $suf) if (is_file($path . $suf)) @unlink($path . $suf);
            out(['ok' => true]);
        }
        $p->exec('DROP DATABASE ' . q($db, $drv)); out(['ok' => true]);

    case 'tables':
        if ($drv === 'sqlite') {
            $r = rows($p, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
            foreach ($r as &$t) { $t['rows'] = $t['type'] === 'table' ? (int)$p->query('SELECT COUNT(*) FROM ' . q($t['name'], $drv))->fetchColumn() : null; $t['size'] = null; $t['engine'] = null; $t['collation'] = null; $t['comment'] = ''; }
        } else {
            $r = rows($p, "SELECT TABLE_NAME name, TABLE_TYPE type, ENGINE engine, TABLE_COLLATION collation, TABLE_COMMENT comment, TABLE_ROWS `rows`, DATA_LENGTH+INDEX_LENGTH size
                           FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY 1", [$db]);
        }
        out(['tables' => $r]);

    case 'structure':
        $isView = false;
        $viewSelect = '';
        if ($drv === 'sqlite') {
            $meta = rows($p, 'SELECT type, sql FROM sqlite_master WHERE name=?', [(string)$tb])[0] ?? [];
            $isView = strtolower((string)($meta['type'] ?? '')) === 'view';
            $create = (string)($meta['sql'] ?? '');
            if ($isView && preg_match('/\bAS\s+(.+)$/is', $create, $vm)) $viewSelect = trim($vm[1]);
            $hasAi = stripos($create, 'AUTOINCREMENT') !== false;
            $cols = array_map(function ($x) use ($hasAi) {
                $pt = parse_coltype($x['type']);
                $isIntPk = $x['pk'] > 0 && in_array($pt['base'], ['INTEGER', 'INT'], true);
                return [
                    'name' => $x['name'],
                    'type' => $x['type'],
                    'null' => !$x['notnull'] && !$x['pk'],
                    'key' => $x['pk'] ? 'PRI' : '',
                    'default' => $x['dflt_value'],
                    'extra' => ($isIntPk && $hasAi) ? 'AUTOINCREMENT' : ($isIntPk ? 'rowid auto' : ''),
                    'parsed' => $pt,
                    'def' => parse_default($x['dflt_value'], !$x['notnull'], '', false, 'sqlite'),
                    'ai' => $isIntPk,
                    'on_update' => false,
                    'collation' => null,
                    'comment' => '',
                ];
            }, rows($p, 'PRAGMA table_info(' . q($tb, $drv) . ')'));
            $idx = $isView ? [] : rows($p, 'PRAGMA index_list(' . q($tb, $drv) . ')');
        } else {
            $maria = stripos((string)$p->query('SELECT VERSION()')->fetchColumn(), 'mariadb') !== false;
            $cols = array_map(function ($x) use ($maria, $drv) {
                $pt = parse_coltype($x['Type']);
                return ['name' => $x['Field'], 'type' => $x['Type'], 'null' => $x['Null'] === 'YES', 'key' => $x['Key'], 'default' => $x['Default'], 'extra' => $x['Extra'],
                    'parsed' => $pt, 'def' => parse_default($x['Default'], $x['Null'] === 'YES', $x['Extra'], $maria, $drv),
                    'ai' => stripos($x['Extra'], 'auto_increment') !== false, 'on_update' => stripos($x['Extra'], 'on update') !== false, 'collation' => $x['Collation'] ?? null, 'comment' => $x['Comment'] ?? ''];
            }, rows($p, "SHOW FULL COLUMNS FROM $T"));
            $rowC = rows($p, "SHOW CREATE TABLE $T")[0] ?? [];
            if (isset($rowC['Create View'])) {
                $isView = true;
                $create = (string)$rowC['Create View'];
                $vDef = (string)(rows($p, 'SELECT VIEW_DEFINITION d FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [$db, $tb])[0]['d'] ?? '');
                if ($vDef !== '') $viewSelect = $vDef;
                elseif (preg_match('/\bAS\s+(.+)$/is', $create, $vm)) $viewSelect = trim($vm[1]);
                $idx = [];
            } else {
                $create = (string)($rowC['Create Table'] ?? '');
                $idx = rows($p, "SHOW INDEX FROM $T");
            }
        }
        out(['columns' => $cols, 'indexes' => $idx, 'create' => $create, 'is_view' => $isView, 'view_select' => $viewSelect]);

    case 'save_view':
        $vname = trim((string)($in['name'] ?? $tb ?? ''));
        $vsel = trim(rtrim(trim((string)($in['select'] ?? '')), ';'));
        if ($vname === '' || $vsel === '') fail('View name and SELECT query are required');
        if (!preg_match('/^\s*(SELECT|WITH)\b/i', $vsel)) fail('View definition must start with SELECT or WITH');
        $VT = ($drv === 'mysql' ? q((string)$db, $drv) . '.' : '') . q($vname, $drv);
        $oldName = trim((string)($in['old_name'] ?? ''));
        if ($drv === 'mysql') {
            $sql = "CREATE OR REPLACE VIEW $VT AS $vsel";
            if (empty($in['dry'])) {
                $p->exec($sql);
                if ($oldName !== '' && $oldName !== $vname) {
                    $p->exec('DROP VIEW IF EXISTS ' . q((string)$db, 'mysql') . '.' . q($oldName, 'mysql'));
                }
            }
        } else {
            $dropTarget = $oldName !== '' ? $oldName : $vname;
            $sql = 'DROP VIEW IF EXISTS ' . q($dropTarget, 'sqlite') . ";\nCREATE VIEW $VT AS $vsel";
            if (empty($in['dry'])) {
                $p->beginTransaction();
                try {
                    if (!empty($in['replace']) || $oldName !== '') {
                        $p->exec('DROP VIEW IF EXISTS ' . q($dropTarget, 'sqlite'));
                    }
                    $p->exec("CREATE VIEW $VT AS $vsel");
                    $p->commit();
                } catch (Throwable $e) {
                    if ($p->inTransaction()) $p->rollBack();
                    throw $e;
                }
            }
        }
        out(['ok' => true, 'name' => $vname, 'sql' => $sql]);

    case 'triggers':
        $trigs = [];
        if ($drv === 'mysql') {
            $sql = 'SELECT TRIGGER_NAME name, EVENT_MANIPULATION event, ACTION_TIMING timing, EVENT_OBJECT_TABLE `table`, ACTION_STATEMENT body
                    FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?' . ($tb ? ' AND EVENT_OBJECT_TABLE = ?' : '') . ' ORDER BY TRIGGER_NAME';
            $trigs = rows($p, $sql, $tb ? [$db, $tb] : [$db]);
            foreach ($trigs as &$tr) {
                $qt = q((string)$db, 'mysql') . '.' . q($tr['name'], 'mysql');
                $tr['sql'] = rows($p, "SHOW CREATE TRIGGER $qt")[0]['SQL Original Statement'] ?? "CREATE TRIGGER {$tr['name']} {$tr['timing']} {$tr['event']} ON {$tr['table']} FOR EACH ROW {$tr['body']}";
            }
        } else {
            $sql = "SELECT name, tbl_name `table`, sql FROM sqlite_master WHERE type='trigger'" . ($tb ? ' AND tbl_name = ?' : '') . ' ORDER BY name';
            foreach (rows($p, $sql, $tb ? [$tb] : []) as $tr) {
                $timing = ''; $event = ''; $body = $tr['sql'] ?? '';
                if (preg_match('/\b(BEFORE|AFTER|INSTEAD\s+OF)\s+(INSERT|UPDATE(?:\s+OF\s+[^\s]+)?|DELETE)\b/i', $body, $m)) {
                    $timing = strtoupper((string)preg_replace('/\s+/', ' ', $m[1]));
                    $event = strtoupper((string)preg_replace('/\s+/', ' ', $m[2]));
                }
                if (preg_match('/\bBEGIN\b(.*)\bEND\s*;?\s*$/is', $body, $bm)) {
                    $body = trim($bm[1]);
                }
                $trigs[] = ['name' => $tr['name'], 'table' => $tr['table'], 'timing' => $timing, 'event' => $event, 'body' => $body, 'sql' => $tr['sql']];
            }
        }
        out(['triggers' => $trigs]);

    case 'create_trigger':
        $tname = trim((string)($in['name'] ?? ''));
        $ttable = trim((string)($in['table'] ?? $tb ?? ''));
        $timing = strtoupper(trim((string)($in['timing'] ?? 'BEFORE')));
        $event = strtoupper(trim((string)($in['event'] ?? 'INSERT')));
        $tbody = trim((string)($in['body'] ?? ''));
        if ($tname === '' || $ttable === '' || $tbody === '') fail('Trigger name, table, and SQL body are required');
        $allowedTimings = $drv === 'sqlite' ? ['BEFORE', 'AFTER', 'INSTEAD OF'] : ['BEFORE', 'AFTER'];
        if (!in_array($timing, $allowedTimings, true)) fail('Invalid trigger timing');
        if (!in_array($event, ['INSERT', 'UPDATE', 'DELETE'], true)) fail('Invalid trigger event');
        $QTN = ($drv === 'mysql' ? q((string)$db, 'mysql') . '.' : '') . q($tname, $drv);
        $QTB = ($drv === 'mysql' ? q((string)$db, 'mysql') . '.' : '') . q($ttable, $drv);
        if (!str_ends_with(rtrim($tbody), ';')) $tbody .= ';';
        $sql = "CREATE TRIGGER $QTN $timing $event ON $QTB FOR EACH ROW\nBEGIN\n  $tbody\nEND";
        if (empty($in['dry'])) $p->exec($sql);
        out(['ok' => true, 'sql' => $sql]);

    case 'drop_trigger':
        $tname = trim((string)($in['name'] ?? ''));
        if ($tname === '') fail('Trigger name required');
        $QTN = ($drv === 'mysql' ? q((string)$db, 'mysql') . '.' : '') . q($tname, $drv);
        $p->exec("DROP TRIGGER IF EXISTS $QTN");
        out(['ok' => true]);

    case 'routines':
        if ($drv !== 'mysql') out(['routines' => [], 'events' => [], 'supported' => false]);
        $routs = rows($p, 'SELECT ROUTINE_NAME name, ROUTINE_TYPE type, DTD_IDENTIFIER returns,ROUTINE_DEFINITION body, CREATED created, LAST_ALTERED altered
                           FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME', [$db]);
        foreach ($routs as &$rt) {
            $qr = q((string)$db, 'mysql') . '.' . q($rt['name'], 'mysql');
            $type = strtoupper($rt['type']) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
            try {
                $rowR = rows($p, "SHOW CREATE $type $qr")[0] ?? [];
                $rt['sql'] = $rowR["Create " . ucfirst(strtolower($type))] ?? '';
            } catch (Throwable) { $rt['sql'] = ''; }
        }
        $evts = [];
        try {
            $evts = rows($p, 'SELECT EVENT_NAME name, EVENT_TYPE type, EXECUTE_AT execute_at, INTERVAL_VALUE interval_val, INTERVAL_FIELD interval_field, STATUS status, EVENT_DEFINITION body
                              FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME', [$db]);
        } catch (Throwable) {}
        out(['routines' => $routs, 'events' => $evts, 'supported' => true]);

    case 'create_routine':
        if ($drv !== 'mysql') fail('Stored routines are supported on MySQL/MariaDB only');
        $rtype = strtoupper(trim((string)($in['type'] ?? 'PROCEDURE'))) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
        $rname = trim((string)($in['name'] ?? ''));
        $rparams = trim((string)($in['params'] ?? ''));
        $rret = trim((string)($in['returns'] ?? 'INT'));
        $det = !empty($in['deterministic']) ? ' DETERMINISTIC' : '';
        $rbody = trim((string)($in['body'] ?? ''));
        if ($rname === '' || $rbody === '') fail('Routine name and body are required');
        if ($rtype === 'FUNCTION' && !preg_match('/^[A-Za-z0-9_(),\s]+$/', $rret)) fail('Invalid return type');
        $QR = q((string)$db, 'mysql') . '.' . q($rname, 'mysql');
        if (!preg_match('/^\s*BEGIN\b/i', $rbody)) {
            if (!str_ends_with(rtrim($rbody), ';')) $rbody .= ';';
            $rbody = "BEGIN\n  $rbody\nEND";
        }
        $sql = "CREATE $rtype $QR($rparams)" . ($rtype === 'FUNCTION' ? " RETURNS $rret$det" : $det) . "\n$rbody";
        if (empty($in['dry'])) {
            if (!empty($in['replace'])) $p->exec("DROP $rtype IF EXISTS $QR");
            $p->exec($sql);
        }
        out(['ok' => true, 'sql' => $sql]);

    case 'drop_routine':
        if ($drv !== 'mysql') fail('MySQL/MariaDB only');
        $rtype = strtoupper(trim((string)($in['type'] ?? 'PROCEDURE'))) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
        $rname = trim((string)($in['name'] ?? ''));
        if ($rname === '') fail('Routine name required');
        $p->exec("DROP $rtype IF EXISTS " . q((string)$db, 'mysql') . '.' . q($rname, 'mysql'));
        out(['ok' => true]);

    case 'browse':
        $page = max(1, (int)($in['page'] ?? 1)); $per = min(500, max(5, (int)($in['per'] ?? 50)));
        $isView = $drv === 'sqlite'
            ? strtolower((string)$p->query("SELECT type FROM sqlite_master WHERE name=" . $p->quote((string)$tb))->fetchColumn()) === 'view'
            : stripos((string)(rows($p, "SELECT TABLE_TYPE t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", [$db, $tb])[0]['t'] ?? ''), 'VIEW') !== false;
        $rawCols = rows($p, $drv === 'sqlite' ? 'PRAGMA table_info(' . q($tb, $drv) . ')' : "SHOW COLUMNS FROM $T");
        $cols = array_column($rawCols, $drv === 'sqlite' ? 'name' : 'Field');
        $colMeta = [];
        foreach ($rawCols as $rc) {
            $cn = $drv === 'sqlite' ? $rc['name'] : $rc['Field'];
            $ct = $drv === 'sqlite' ? $rc['type'] : $rc['Type'];
            $pt = parse_coltype($ct);
            $isAi = $drv === 'sqlite'
                ? (!empty($rc['pk']) && in_array($pt['base'], ['INTEGER', 'INT'], true))
                : (stripos((string)($rc['Extra'] ?? ''), 'auto_increment') !== false);
            $colMeta[$cn] = $pt + [
                'raw_type' => $ct,
                'null' => $drv === 'sqlite' ? (!$rc['notnull'] && !$rc['pk']) : ($rc['Null'] === 'YES'),
                'ai' => $isAi,
                'extra' => $drv === 'sqlite' ? ($isAi ? 'rowid auto' : '') : ($rc['Extra'] ?? ''),
                'has_default' => $drv === 'sqlite' ? ($rc['dflt_value'] !== null) : (($rc['Default'] ?? null) !== null),
            ];
        }
        $args = [];
        [$where, $order] = filter_sql($drv, $cols, $in, $args);
        $total = (int)rows($p, "SELECT COUNT(*) n FROM $T$where", $args)[0]['n'];
        $pk = [];
        $uk = [];
        $keyCols = [];
        $keyType = 'none';
        $useRowid = false;
        if ($drv === 'sqlite') {
            foreach ($rawCols as $x) if ($x['pk']) $pk[] = $x['name'];
            if ($pk) {
                $keyCols = $pk;
                $keyType = 'pk';
            } elseif (!$isView) {
                try {
                    $p->query("SELECT rowid FROM $T LIMIT 1");
                    $keyCols = ['__rowid__'];
                    $keyType = 'rowid';
                    $useRowid = true;
                } catch (Throwable) {
                    foreach (list_indexes($p, $drv, $T, $tb) as $ix) {
                        if ($ix['type'] === 'UNIQUE' && $ix['columns']) {
                            $uk = array_column($ix['columns'], 'name');
                            break;
                        }
                    }
                    $keyCols = $uk ?: $cols;
                    $keyType = $uk ? 'unique' : 'all';
                }
            }
        } else {
            foreach ($rawCols as $x) if ($x['Key'] === 'PRI') $pk[] = $x['Field'];
            if ($pk) {
                $keyCols = $pk;
                $keyType = 'pk';
            } elseif (!$isView) {
                $uIdx = [];
                foreach (rows($p, "SHOW INDEX FROM $T") as $ix) {
                    if (!$ix['Non_unique'] && $ix['Key_name'] !== 'PRIMARY' && empty($ix['Sub_part'])) {
                        $uIdx[$ix['Key_name']][] = $ix['Column_name'];
                    }
                }
                foreach ($uIdx as $uCols) {
                    $allNotNull = true;
                    foreach ($uCols as $uc) if (!empty($colMeta[$uc]['null'])) { $allNotNull = false; break; }
                    if ($allNotNull) { $uk = $uCols; break; }
                }
                if (!$uk && $uIdx) $uk = reset($uIdx);
                $keyCols = $uk ?: $cols;
                $keyType = $uk ? 'unique' : 'all';
            }
        }
        $selCols = $useRowid ? 'rowid AS "__rowid__", *' : '*';
        $data = rows($p, "SELECT $selCols FROM $T$where$order LIMIT $per OFFSET " . (($page - 1) * $per), $args);
        $fkMap = [];
        foreach (list_fks($p, $drv, $db, $tb) as $f) {
            foreach ($f['pairs'] as $pr) {
                $fkMap[$pr['col']] = [
                    'ref_db' => $f['ref_db'] ?: $db,
                    'ref_table' => $f['ref_table'],
                    'ref_col' => $pr['ref'],
                ];
            }
        }
        out(['rows' => $data, 'columns' => $cols, 'col_meta' => $colMeta, 'fks' => $fkMap, 'total' => $total, 'pk' => $pk, 'uk' => $uk, 'key_cols' => $keyCols, 'key_type' => $keyType, 'is_view' => $isView, 'page' => $page, 'per' => $per]);

    case 'fk_lookup':
        $refDb = (string)($in['ref_db'] ?? $db);
        $refTb = (string)($in['ref_table'] ?? '');
        $refCol = (string)($in['ref_col'] ?? '');
        if ($refTb === '' || $refCol === '') fail('Referenced table and column required');
        $RT = ($drv === 'mysql' ? q($refDb, $drv) . '.' : '') . q($refTb, $drv);
        $rCols = table_cols($p, $drv, $RT, $refTb);
        if (!in_array($refCol, $rCols, true)) fail("Column '$refCol' not found in '$refTb'");
        // Pick up to 2 descriptive display columns alongside the referenced key column
        $labelCols = array_slice(array_values(array_filter($rCols, fn($c) => $c !== $refCol)), 0, 2);
        $selList = implode(', ', array_map(fn($c) => q($c, $drv), array_merge([$refCol], $labelCols)));
        $qSearch = trim((string)($in['q'] ?? ''));
        $w = ''; $wArgs = [];
        if ($qSearch !== '') {
            $parts = [];
            foreach (array_merge([$refCol], $labelCols) as $sc) {
                $parts[] = 'CAST(' . q($sc, $drv) . ' AS ' . ($drv === 'mysql' ? 'CHAR' : 'TEXT') . ') LIKE ?';
                $wArgs[] = "%$qSearch%";
            }
            $w = ' WHERE ' . implode(' OR ', $parts);
        }
        $lRows = rows($p, "SELECT $selList FROM $RT$w ORDER BY " . q($refCol, $drv) . " ASC LIMIT 200", $wArgs);
        $items = [];
        foreach ($lRows as $lr) {
            $v = $lr[$refCol];
            $desc = [];
            foreach ($labelCols as $lc) {
                if (($lr[$lc] ?? null) !== null && (string)$lr[$lc] !== '') {
                    $s = (string)$lr[$lc];
                    $desc[] = strlen($s) > 40 ? substr($s, 0, 40) . '…' : $s;
                }
            }
            $items[] = ['val' => $v, 'label' => $desc ? implode(' · ', $desc) : ''];
        }
        out(['items' => $items, 'ref_table' => $refTb, 'ref_col' => $refCol]);

    case 'insert':
        $v = $in['values'] ?? [];
        if (!$v) { $p->exec($drv === 'sqlite' ? "INSERT INTO $T DEFAULT VALUES" : "INSERT INTO $T () VALUES ()"); out(['ok' => true]); }
        $names = implode(',', array_map(fn($k) => q($k, $drv), array_keys($v)));
        $ph = implode(',', array_fill(0, count($v), '?'));
        $p->prepare("INSERT INTO $T ($names) VALUES ($ph)")->execute(array_values($v)); out(['ok' => true]);

    case 'update':
    case 'delete':
        $key = $in['key'] ?? [];
        if (!$key || !is_array($key)) fail('Row identifier key is required');
        $w = []; $args = [];
        foreach ($key as $k => $val) {
            $colSql = ($drv === 'sqlite' && $k === '__rowid__') ? 'rowid' : q((string)$k, $drv);
            if ($val === null) $w[] = "$colSql IS NULL";
            else { $w[] = "$colSql = ?"; $args[] = $val; }
        }
        $w = implode(' AND ', $w);
        $limit = $drv === 'mysql' ? ' LIMIT 1' : '';
        if ($a === 'delete') {
            $s = $p->prepare("DELETE FROM $T WHERE $w$limit");
            $s->execute($args);
            out(['ok' => true, 'affected' => $s->rowCount()]);
        }
        $v = $in['values'] ?? [];
        if (!$v || !is_array($v)) fail('No column values provided for update');
        $set = implode(',', array_map(fn($k) => q($k, $drv) . ' = ?', array_keys($v)));
        $s = $p->prepare("UPDATE $T SET $set WHERE $w$limit");
        $s->execute(array_merge(array_values($v), $args));
        out(['ok' => true, 'affected' => $s->rowCount()]);

    case 'bulk_delete':
        $keys = $in['keys'] ?? [];
        if (!$keys || !is_array($keys)) fail('Select at least one row to delete');
        $limit = $drv === 'mysql' ? ' LIMIT 1' : '';
        $deleted = 0;
        $p->beginTransaction();
        try {
            foreach ($keys as $key) {
                if (!is_array($key) || !$key) continue;
                $w = []; $args = [];
                foreach ($key as $k => $val) {
                    $colSql = ($drv === 'sqlite' && $k === '__rowid__') ? 'rowid' : q((string)$k, $drv);
                    if ($val === null) $w[] = "$colSql IS NULL";
                    else { $w[] = "$colSql = ?"; $args[] = $val; }
                }
                $s = $p->prepare("DELETE FROM $T WHERE " . implode(' AND ', $w) . $limit);
                $s->execute($args);
                $deleted += $s->rowCount();
            }
            $p->commit();
        } catch (Throwable $e) {
            if ($p->inTransaction()) $p->rollBack();
            throw $e;
        }
        out(['ok' => true, 'affected' => $deleted]);

    case 'bulk_update':
        $limit = $drv === 'mysql' ? ' LIMIT 1' : '';
        $updated = 0;
        $items = [];
        if (!empty($in['updates']) && is_array($in['updates'])) {
            // Individual per-row updates: [{key: {...}, values: {...}}, ...]
            $items = $in['updates'];
        } elseif (!empty($in['keys']) && is_array($in['keys']) && !empty($in['values']) && is_array($in['values'])) {
            // Batch update: same values applied to multiple row keys
            foreach ($in['keys'] as $k) $items[] = ['key' => $k, 'values' => $in['values']];
        } else {
            fail('No row updates provided');
        }
        $p->beginTransaction();
        try {
            foreach ($items as $item) {
                $key = $item['key'] ?? [];
                $vals = $item['values'] ?? [];
                if (!is_array($key) || !$key || !is_array($vals) || !$vals) continue;
                $w = []; $args = [];
                foreach ($key as $k => $val) {
                    $colSql = ($drv === 'sqlite' && $k === '__rowid__') ? 'rowid' : q((string)$k, $drv);
                    if ($val === null) $w[] = "$colSql IS NULL";
                    else { $w[] = "$colSql = ?"; $args[] = $val; }
                }
                $set = implode(',', array_map(fn($k) => q((string)$k, $drv) . ' = ?', array_keys($vals)));
                $s = $p->prepare("UPDATE $T SET $set WHERE " . implode(' AND ', $w) . $limit);
                $s->execute(array_merge(array_values($vals), $args));
                $updated += $s->rowCount();
            }
            $p->commit();
        } catch (Throwable $e) {
            if ($p->inTransaction()) $p->rollBack();
            throw $e;
        }
        out(['ok' => true, 'affected' => $updated]);

    case 'query':
        $results = [];
        $stmts = split_sql_statements((string)($in['sql'] ?? ''), $drv);
        $maxRows = (int)($in['max_rows'] ?? 1000);
        foreach ($stmts as $st) {
            try { $r = run_sql($p, $st, $maxRows); $r['sql'] = trim($st); $results[] = $r; }
            catch (Throwable $e) { $results[] = ['sql' => trim($st), 'error' => $e->getMessage()]; break; }
        }
        out(['results' => $results]);

    case 'import_sql_file':
        if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
            fail('No SQL file uploaded (check upload_max_filesize in php.ini if the file is very large)');
        }
        $origName = (string)($_FILES['file']['name'] ?? 'import.sql');
        $rawBytes = @file_get_contents($_FILES['file']['tmp_name']);
        if ($rawBytes === false) fail('Unable to read uploaded file');
        $sqlText = decode_archive_payload($rawBytes, $origName);
        unset($rawBytes);
        $stmts = split_sql_statements($sqlText, $drv);
        unset($sqlText);
        $executed = 0;
        foreach ($stmts as $st) {
            try {
                $p->exec($st);
                $executed++;
            } catch (Throwable $e) {
                out(['ok' => false, 'executed' => $executed, 'total' => count($stmts), 'error' => $e->getMessage(), 'failed_sql' => substr(trim($st), 0, 300)]);
            }
        }
        out(['ok' => true, 'executed' => $executed, 'total' => count($stmts)]);

    case 'decompress_file':
        if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
            fail('No file uploaded');
        }
        $origName = (string)($_FILES['file']['name'] ?? 'file.csv');
        $rawBytes = @file_get_contents($_FILES['file']['tmp_name']);
        if ($rawBytes === false) fail('Unable to read uploaded file');
        $text = decode_archive_payload($rawBytes, $origName);
        out(['ok' => true, 'text' => $text, 'name' => preg_replace('/\.(gz|zip)$/i', '', $origName)]);

    case 'drop_table':
        $isV = $drv === 'sqlite'
            ? strtolower((string)$p->query("SELECT type FROM sqlite_master WHERE name=" . $p->quote((string)$tb))->fetchColumn()) === 'view'
            : stripos((string)(rows($p, "SELECT TABLE_TYPE t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", [$db, $tb])[0]['t'] ?? ''), 'VIEW') !== false;
        $p->exec('DROP ' . ($isV ? 'VIEW ' : 'TABLE ') . $T);
        out(['ok' => true]);

    case 'truncate':
        if ($drv === 'mysql') {
            $p->exec("TRUNCATE TABLE $T");
        } else {
            $p->exec("DELETE FROM $T");
            try { $p->exec('DELETE FROM sqlite_sequence WHERE name=' . $p->quote((string)$tb)); } catch (Throwable) {}
        }
        out(['ok' => true]);

    case 'rename_table':
        $p->exec($drv === 'mysql' ? "RENAME TABLE $T TO " . q((string)$db, $drv) . '.' . q($in['to'], $drv) : "ALTER TABLE $T RENAME TO " . q($in['to'], $drv)); out(['ok' => true]);

    case 'table_meta':
        $nextAi = null;
        if ($drv === 'mysql') {
            $nextAi = rows($p, 'SELECT AUTO_INCREMENT ai FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [$db, $tb])[0]['ai'] ?? null;
        } else {
            try {
                $seq = $p->query('SELECT seq FROM sqlite_sequence WHERE name=' . $p->quote((string)$tb))->fetchColumn();
                if ($seq !== false) $nextAi = ((int)$seq) + 1;
            } catch (Throwable) {}
        }
        out(['auto_increment' => $nextAi !== null ? (int)$nextAi : null]);

    case 'table_maint':
        $op = strtolower(trim((string)($in['op'] ?? '')));
        if ($drv === 'mysql') {
            $sqlMap = [
                'check' => "CHECK TABLE $T",
                'analyze' => "ANALYZE TABLE $T",
                'optimize' => "OPTIMIZE TABLE $T",
                'repair' => "REPAIR TABLE $T",
            ];
            if ($op === 'auto_increment') {
                $val = max(1, (int)($in['value'] ?? 1));
                $p->exec("ALTER TABLE $T AUTO_INCREMENT = $val");
                out(['ok' => true, 'messages' => [['op' => 'AUTO_INCREMENT', 'type' => 'status', 'text' => "Next AUTO_INCREMENT set to $val"]]]);
            }
            if (!isset($sqlMap[$op])) fail("Unsupported MySQL maintenance operation '$op'");
            $resRows = rows($p, $sqlMap[$op]);
            $msgs = array_map(fn($r) => ['op' => $r['Op'] ?? strtoupper($op), 'type' => $r['Msg_type'] ?? 'status', 'text' => $r['Msg_text'] ?? 'OK'], $resRows);
            out(['ok' => true, 'messages' => $msgs]);
        } else {
            if ($op === 'vacuum') {
                $p->exec('VACUUM');
                out(['ok' => true, 'messages' => [['op' => 'VACUUM', 'type' => 'status', 'text' => 'Database file rebuilt and compacted (VACUUM complete)']]]);
            }
            if ($op === 'analyze') {
                $target = $T ?: '';
                $p->exec('ANALYZE' . ($target ? " $target" : ''));
                out(['ok' => true, 'messages' => [['op' => 'ANALYZE', 'type' => 'status', 'text' => 'Query planner statistics updated (ANALYZE complete)']]]);
            }
            if ($op === 'integrity_check') {
                $res = array_column($p->query('PRAGMA integrity_check')->fetchAll(PDO::FETCH_NUM), 0);
                out(['ok' => true, 'messages' => array_map(fn($m) => ['op' => 'integrity_check', 'type' => $m === 'ok' ? 'status' : 'error', 'text' => $m], $res)]);
            }
            if ($op === 'foreign_key_check') {
                $res = rows($p, 'PRAGMA foreign_key_check' . ($T ? "($T)" : ''));
                $msgs = $res ? array_map(fn($r) => ['op' => 'foreign_key_check', 'type' => 'error', 'text' => "Table {$r['table']} rowid {$r['rowid']} violates FK to {$r['parent']}"], $res)
                             : [['op' => 'foreign_key_check', 'type' => 'status', 'text' => 'ok (no foreign key violations found)']];
                out(['ok' => true, 'messages' => $msgs]);
            }
            if ($op === 'auto_increment') {
                $val = max(0, ((int)($in['value'] ?? 1)) - 1);
                $p->exec('UPDATE sqlite_sequence SET seq = ' . $val . ' WHERE name = ' . $p->quote((string)$tb));
                out(['ok' => true, 'messages' => [['op' => 'sqlite_sequence', 'type' => 'status', 'text' => 'Next AUTOINCREMENT set to ' . ($val + 1)]]]);
            }
            fail("Unsupported SQLite maintenance operation '$op'");
        }

    case 'processlist':
        if ($drv !== 'mysql') out(['processes' => [], 'supported' => false]);
        $myId = (int)$p->query('SELECT CONNECTION_ID()')->fetchColumn();
        $procs = rows($p, 'SHOW FULL PROCESSLIST');
        out(['processes' => $procs, 'my_id' => $myId, 'supported' => true]);

    case 'kill_process':
        if ($drv !== 'mysql') fail('MySQL/MariaDB only');
        $pid = (int)($in['id'] ?? 0);
        if ($pid <= 0) fail('Invalid process ID');
        $qOnly = !empty($in['query_only']) ? ' QUERY' : '';
        $p->exec("KILL$qOnly $pid");
        out(['ok' => true]);

    case 'create_table':
        // columns: [{name,type,length,null,pk,ai,default,default_mode,on_update}]
        $colsIn = array_values($in['columns'] ?? []);
        $pkCount = count(array_filter($colsIn, fn($c) => !empty($c['pk'])));
        $defs = []; $pks = [];
        $exprs = ['CURRENT_TIMESTAMP', 'NOW()', 'CURDATE()', 'CURRENT_DATE', 'CURTIME()', 'CURRENT_TIME', 'UUID()'];
        $sqliteInts = ['INT', 'INTEGER', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT'];
        foreach ($colsIn as $col) {
            $type = strtoupper($col['type'] ?? 'INT');
            if (!in_array($type, COL_TYPES, true)) fail("Unsupported type $type");
            if ($drv === 'sqlite' && in_array($type, ['ENUM', 'SET'], true)) $type = 'TEXT';
            $len = trim((string)($col['length'] ?? ''));
            if ($len !== '' && !preg_match('/^\d+(,\d+)?$/', $len)) fail('Invalid length');
            $isSqliteSinglePk = $drv === 'sqlite' && $pkCount === 1 && !empty($col['pk']);
            if ($isSqliteSinglePk && (!empty($col['ai']) || in_array($type, $sqliteInts, true))) {
                // SQLite requires exact `INTEGER PRIMARY KEY [AUTOINCREMENT]` syntax immediately after the type
                $d = q($col['name'], $drv) . ' INTEGER PRIMARY KEY' . (!empty($col['ai']) ? ' AUTOINCREMENT' : '');
                if (empty($col['null'])) $d .= ' NOT NULL';
            } else {
                $d = q($col['name'], $drv) . ' ' . $type . ($len !== '' ? "($len)" : '');
                if ($isSqliteSinglePk) $d .= ' PRIMARY KEY';
                if (empty($col['null'])) $d .= ' NOT NULL'; else $d .= ' NULL';
                if (!empty($col['ai']) && $drv === 'mysql') $d .= ' AUTO_INCREMENT';
            }
            $defVal = trim((string)($col['default'] ?? ''));
            $defMode = $col['default_mode'] ?? '';
            if ($defMode === 'null' || strtoupper($defVal) === 'NULL') {
                $d .= ' DEFAULT NULL';
            } elseif ($defMode === 'expr' || in_array(strtoupper($defVal), $exprs, true) || ($drv === 'sqlite' && str_contains($defVal, '('))) {
                $d .= ' DEFAULT ' . norm_default_expr($defVal ?: 'CURRENT_TIMESTAMP', $drv);
            } elseif ($defVal !== '') {
                $d .= ' DEFAULT ' . $p->quote($defVal);
            }
            if ($drv === 'mysql' && !empty($col['on_update']) && in_array($type, ['DATETIME', 'TIMESTAMP'], true)) {
                $d .= ' ON UPDATE CURRENT_TIMESTAMP';
            }
            if (!empty($col['pk'])) { $pks[] = q($col['name'], $drv); }
            $defs[] = $d;
        }
        if (!$defs) fail('At least one column required');
        if ($pks && !($drv === 'sqlite' && $pkCount === 1)) {
            $defs[] = 'PRIMARY KEY (' . implode(',', $pks) . ')';
        }
        $tail = '';
        if ($drv === 'mysql') {
            $eng = trim((string)($in['engine'] ?? ''));
            if ($eng !== '') {
                if (!preg_match('/^[A-Za-z0-9_]+$/', $eng)) fail('Invalid storage engine');
                $tail .= " ENGINE=$eng";
            }
            $coll = trim((string)($in['collation'] ?? ''));
            if ($coll !== '') {
                if (!preg_match('/^[a-z0-9]+_[a-z0-9_]+$/i', $coll)) fail('Invalid collation');
                $cs = explode('_', $coll)[0];
                $tail .= " DEFAULT CHARSET=$cs COLLATE=$coll";
            }
            $cmt = trim((string)($in['comment'] ?? ''));
            if ($cmt !== '') $tail .= ' COMMENT=' . $p->quote($cmt);
        }
        $p->exec("CREATE TABLE $T (" . implode(', ', $defs) . ")$tail"); out(['ok' => true]);

    case 'alter_table_options':
        if ($drv !== 'mysql') fail('MySQL/MariaDB only');
        $parts = []; $stmts = []; $fkDrops = []; $fkAdds = [];
        $eng = trim((string)($in['engine'] ?? ''));
        if ($eng !== '') {
            if (!preg_match('/^[A-Za-z0-9_]+$/', $eng)) fail('Invalid storage engine');
            $parts[] = "ENGINE=$eng";
        }
        $coll = trim((string)($in['collation'] ?? ''));
        $cmode = $in['conv_mode'] ?? (!empty($in['convert_columns']) ? 'convert' : 'default_only'); // convert | default_only | binary
        if ($coll !== '') {
            if (!preg_match('/^[a-z0-9]+_[a-z0-9_]+$/i', $coll)) fail('Invalid collation');
            $cs = explode('_', $coll)[0];
            if (in_array($cmode, ['convert', 'binary'], true)) {
                [$fkDrops, $fkAdds] = fk_text_conversion_guards($p, (string)$db, (string)$tb);
                array_push($stmts, ...$fkDrops);
            }
            if ($cmode === 'convert') $parts[] = "CONVERT TO CHARACTER SET $cs COLLATE $coll";
            elseif ($cmode === 'default_only') $parts[] = "DEFAULT CHARACTER SET $cs COLLATE $coll";
        }
        if (array_key_exists('comment', $in)) {
            $parts[] = 'COMMENT=' . $p->quote((string)$in['comment']);
        }
        if ($parts) $stmts[] = "ALTER TABLE $T " . implode(', ', $parts);
        if ($coll !== '' && $cmode === 'binary') {
            array_push($stmts, ...binary_relabel_table_sql($p, (string)$db, (string)$tb, $cs, $coll));
        }
        if ($fkAdds) array_push($stmts, ...$fkAdds);
        if (!$stmts) fail('No table options changed');
        if (empty($in['dry'])) {
            if ($fkDrops) $p->exec('SET FOREIGN_KEY_CHECKS=0');
            try { foreach ($stmts as $s) $p->exec($s); }
            finally { if ($fkDrops) $p->exec('SET FOREIGN_KEY_CHECKS=1'); }
        }
        out(['ok' => true, 'sql' => implode(";\n", $stmts), 'statements' => $stmts]);

    case 'drop_column': $p->exec("ALTER TABLE $T DROP COLUMN " . q($in['column'], $drv)); out(['ok' => true]);
    case 'add_column':
    case 'alter_column':
        $name = trim((string)($in['name'] ?? ''));
        if ($name === '') fail('Column name required');
        if ($a === 'add_column') {
            $def = col_def($p, $drv, $in, true);
            $sql = "ALTER TABLE $T ADD COLUMN " . q($name, $drv) . " $def" . col_pos($drv, $in);
        } elseif ($drv === 'mysql') {
            $def = col_def($p, $drv, $in, false);
            $sql = "ALTER TABLE $T CHANGE COLUMN " . q((string)$in['column'], $drv) . ' ' . q($name, $drv) . " $def" . col_pos($drv, $in);
        } else {
            if ($name === $in['column']) fail('SQLite can only rename columns; other changes need a table rebuild (use the SQL editor).');
            $sql = "ALTER TABLE $T RENAME COLUMN " . q((string)$in['column'], $drv) . ' TO ' . q($name, $drv);
        }
        if (empty($in['dry'])) $p->exec($sql);
        out(['ok' => true, 'sql' => $sql]);

    case 'indexes': out(['indexes' => list_indexes($p, $drv, $T, $tb)]);
    case 'foreign_keys': out(['foreign_keys' => list_fks($p, $drv, $db, $tb), 'supported' => $drv === 'mysql']);

    case 'add_index':
        $type = strtoupper((string)($in['type'] ?? 'INDEX'));
        if (!in_array($type, ['INDEX', 'UNIQUE', 'PRIMARY', 'FULLTEXT'], true)) fail('Invalid index type');
        $cols = col_list($drv, $in['columns'] ?? [], true);
        $iname = trim((string)($in['name'] ?? ''));
        if ($drv === 'mysql') {
            $sql = $type === 'PRIMARY' ? "ALTER TABLE $T ADD PRIMARY KEY $cols"
                : "ALTER TABLE $T ADD " . ($type === 'UNIQUE' ? 'UNIQUE ' : ($type === 'FULLTEXT' ? 'FULLTEXT ' : '')) . 'INDEX ' . ($iname !== '' ? q($iname, $drv) . ' ' : '') . $cols;
        } else {
            if (in_array($type, ['PRIMARY', 'FULLTEXT'], true)) fail("SQLite cannot add a $type key to an existing table");
            if ($iname === '') $iname = 'idx_' . $tb . '_' . implode('_', array_map(fn($c) => is_array($c) ? $c['name'] : $c, $in['columns']));
            $sql = 'CREATE ' . ($type === 'UNIQUE' ? 'UNIQUE ' : '') . 'INDEX ' . q($iname, $drv) . " ON " . q((string)$tb, $drv) . " $cols";
        }
        if (empty($in['dry'])) $p->exec($sql);
        out(['ok' => true, 'sql' => $sql]);

    case 'drop_index':
        $iname = (string)($in['name'] ?? '');
        $sql = $drv === 'mysql' ? ($iname === 'PRIMARY' ? "ALTER TABLE $T DROP PRIMARY KEY" : "ALTER TABLE $T DROP INDEX " . q($iname, $drv)) : 'DROP INDEX ' . q($iname, $drv);
        if (empty($in['dry'])) $p->exec($sql);
        out(['ok' => true, 'sql' => $sql]);

    case 'add_fk':
        if ($drv !== 'mysql') fail('SQLite cannot add foreign keys to an existing table (use the SQL editor to rebuild it)');
        $pairs = array_values(array_filter($in['pairs'] ?? [], fn($x) => ($x['col'] ?? '') !== '' && ($x['ref'] ?? '') !== ''));
        if (!$pairs) fail('Pick at least one column pair');
        $od = strtoupper((string)($in['on_delete'] ?? 'RESTRICT')); $ou = strtoupper((string)($in['on_update'] ?? 'RESTRICT'));
        if (!in_array($od, FK_RULES, true) || !in_array($ou, FK_RULES, true)) fail('Invalid referential action');
        $rt = (string)($in['ref_table'] ?? ''); if ($rt === '') fail('Referenced table required');
        $rdb = (string)($in['ref_db'] ?? $db);
        $fname = trim((string)($in['name'] ?? ''));
        $sql = "ALTER TABLE $T ADD " . ($fname !== '' ? 'CONSTRAINT ' . q($fname, $drv) . ' ' : '') . 'FOREIGN KEY ' . col_list($drv, array_column($pairs, 'col'))
            . ' REFERENCES ' . q($rdb, $drv) . '.' . q($rt, $drv) . ' ' . col_list($drv, array_column($pairs, 'ref')) . " ON DELETE $od ON UPDATE $ou";
        if (empty($in['dry'])) $p->exec($sql);
        out(['ok' => true, 'sql' => $sql]);

    case 'drop_fk':
        if ($drv !== 'mysql') fail('SQLite cannot drop foreign keys from an existing table');
        $sql = "ALTER TABLE $T DROP FOREIGN KEY " . q((string)($in['name'] ?? ''), $drv);
        if (empty($in['dry'])) $p->exec($sql);
        out(['ok' => true, 'sql' => $sql]);

    case 'export_csv':
        $cols = table_cols($p, $drv, $T, $tb);
        $fargs = [];
        [$where, $order] = filter_sql($drv, $cols, $in, $fargs);
        $delim = in_array($in['delimiter'] ?? ',', [',', ';', "\t", '|'], true) ? ($in['delimiter'] ?? ',') : ',';
        $nullStr = (string)($in['null_as'] ?? '');
        $comp = strtolower((string)($in['compress'] ?? 'none')); // none | gzip | zip
        $baseName = preg_replace('/[^\w.-]+/', '_', (string)$tb) . '.csv';
        if ($drv === 'mysql') $p->setAttribute(defined('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY') ? constant('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY') : 1000, false);
        $st = $p->prepare("SELECT * FROM $T$where$order"); $st->execute($fargs);
        header_remove('Content-Type');
        if ($comp === 'none') {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $baseName . '"');
            $fh = fopen('php://output', 'w');
            if (!empty($in['bom'])) fwrite($fh, "\xEF\xBB\xBF");
            if (!empty($in['header'])) fputcsv($fh, $cols, $delim, '"', '');
            while ($r = $st->fetch(PDO::FETCH_NUM)) fputcsv($fh, array_map(fn($v) => $v === null ? $nullStr : $v, $r), $delim, '"', '');
            exit;
        }
        ob_start();
        $fh = fopen('php://output', 'w');
        if (!empty($in['bom'])) fwrite($fh, "\xEF\xBB\xBF");
        if (!empty($in['header'])) fputcsv($fh, $cols, $delim, '"', '');
        while ($r = $st->fetch(PDO::FETCH_NUM)) fputcsv($fh, array_map(fn($v) => $v === null ? $nullStr : $v, $r), $delim, '"', '');
        fclose($fh);
        $csvData = (string)ob_get_clean();
        if ($comp === 'gzip') {
            header('Content-Type: application/gzip');
            header('Content-Disposition: attachment; filename="' . $baseName . '.gz"');
            echo gzencode($csvData, 6);
        } elseif ($comp === 'zip') {
            header('Content-Type: application/zip');
            header('Content-Disposition: attachment; filename="' . $baseName . '.zip"');
            echo build_single_file_zip($baseName, $csvData);
        }
        exit;

    case 'import_rows':
        $icols = $in['columns'] ?? []; $irows = $in['rows'] ?? [];
        if (!$icols || !is_array($icols)) fail('No columns mapped');
        $mode = $in['mode'] ?? 'insert';
        $verb = ['insert' => 'INSERT INTO', 'ignore' => $drv === 'mysql' ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO', 'replace' => $drv === 'mysql' ? 'REPLACE INTO' : 'INSERT OR REPLACE INTO'][$mode] ?? fail('Invalid mode');
        $emptyNull = !empty($in['empty_null']); $n = count($icols); $done = 0;
        $names = implode(',', array_map(fn($c) => q((string)$c, $drv), $icols));
        $per = max(1, intdiv(30000, $n));
        $p->beginTransaction();
        try {
            foreach (array_chunk($irows, $per) as $chunk) {
                $args = [];
                foreach ($chunk as $i => $r) {
                    if (!is_array($r) || count($r) !== $n) throw new InvalidArgumentException('Row ' . ($i + 1) . ' has the wrong number of values');
                    foreach ($r as $v) $args[] = ($emptyNull && $v === '') ? null : $v;
                }
                $one = '(' . implode(',', array_fill(0, $n, '?')) . ')';
                $stm = $p->prepare("$verb $T ($names) VALUES " . implode(',', array_fill(0, count($chunk), $one)));
                $stm->execute($args); $done += $stm->rowCount();
            }
            $p->commit();
        } catch (Throwable $e) { if ($p->inTransaction()) $p->rollBack(); throw $e; }
        out(['ok' => true, 'imported' => $done, 'received' => count($irows)]);

    case 'export':
    case 'export_sql':
        $tables = $in['tables'] ?? [];
        $wantStruct = !empty($in['structure']);
        $wantData = !empty($in['data']);
        $includeCreateDb = !empty($in['create_db']);
        $comp = strtolower((string)($in['compress'] ?? 'none')); // none | gzip | zip
        $stream = ($a === 'export_sql') || !empty($in['stream']);
        $fileLabel = (count($tables) === 1 && $tb) ? $tb : ($db ?: 'fandejo');
        $baseName = preg_replace('/[^\w.-]+/', '_', (string)$fileLabel) . '.sql';
        if ($stream && $comp === 'none') {
            header_remove('Content-Type');
            header('Content-Type: application/sql; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $baseName . '"');
            $fh = fopen('php://output', 'w');
            $emit = function (string $chunk) use ($fh): void { fwrite($fh, $chunk); };
        } else {
            $buf = '';
            $emit = function (string $chunk) use (&$buf): void { $buf .= $chunk; };
        }

        $emit("-- Fandejo SQL Export\n-- Engine: $drv | Database: " . ($db ?? 'main') . "\n-- Generated: " . date('c') . "\n\n");
        $emit($drv === 'mysql' ? "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n" : "PRAGMA foreign_keys=OFF;\n\n");
        if ($drv === 'mysql' && $includeCreateDb && $db) {
            $qd = q((string)$db, 'mysql');
            $createDbSql = rows($p, "SHOW CREATE DATABASE $qd")[0]['Create Database'] ?? "CREATE DATABASE $qd";
            $createDbSql = preg_replace('/^CREATE DATABASE\s+/i', 'CREATE DATABASE IF NOT EXISTS ', $createDbSql);
            $emit("$createDbSql;\nUSE $qd;\n\n");
        }

        $viewsQueue = [];
        foreach ($tables as $t) {
            $TT = ($drv === 'mysql' ? q((string)$db, $drv) . '.' : '') . q((string)$t, $drv);
            $isV = false;
            $create = '';
            if ($drv === 'mysql') {
                $rowC = rows($p, "SHOW CREATE TABLE $TT")[0] ?? [];
                if (isset($rowC['Create View'])) {
                    $isV = true;
                    $create = $rowC['Create View'];
                } else {
                    $create = $rowC['Create Table'] ?? '';
                }
            } else {
                $meta = rows($p, 'SELECT type, sql FROM sqlite_master WHERE name=?', [(string)$t])[0] ?? [];
                $isV = strtolower((string)($meta['type'] ?? '')) === 'view';
                $create = (string)($meta['sql'] ?? '');
            }

            if ($isV) {
                if ($wantStruct && $create !== '') {
                    $viewsQueue[] = "-- View: $t\nDROP VIEW IF EXISTS $TT;\n$create;\n\n";
                }
                continue; // Do not export row data for views
            }

            $blobCols = [];
            if ($wantData) {
                $rawCols = rows($p, $drv === 'sqlite' ? 'PRAGMA table_info(' . q((string)$t, $drv) . ')' : "SHOW COLUMNS FROM $TT");
                foreach ($rawCols as $rc) {
                    $cn = $drv === 'sqlite' ? $rc['name'] : $rc['Field'];
                    $ct = strtoupper((string)($drv === 'sqlite' ? $rc['type'] : $rc['Type']));
                    if (str_contains($ct, 'BLOB') || str_contains($ct, 'BINARY')) $blobCols[$cn] = true;
                }
            }

            if ($wantStruct && $create !== '') {
                $emit("-- Table structure for $t\nDROP TABLE IF EXISTS $TT;\n$create;\n\n");
            }
            if ($wantData) {
                if ($drv === 'mysql') $p->setAttribute(defined('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY') ? constant('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY') : 1000, false);
                $s = $p->query("SELECT * FROM $TT");
                $batch = [];
                $colHeader = '';
                while ($r = $s->fetch(PDO::FETCH_ASSOC)) {
                    if ($colHeader === '') {
                        $colHeader = "INSERT INTO $TT (" . implode(',', array_map(fn($k) => q((string)$k, $drv), array_keys($r))) . ") VALUES\n";
                    }
                    $vals = [];
                    foreach ($r as $cn => $v) {
                        if ($v === null) {
                            $vals[] = 'NULL';
                        } elseif (isset($blobCols[$cn]) || (str_contains((string)$v, "\0") || !preg_match('//u', (string)$v))) {
                            $hex = bin2hex((string)$v);
                            $vals[] = $drv === 'sqlite' ? "X'$hex'" : ($hex === '' ? "''" : "0x$hex");
                        } else {
                            $vals[] = $p->quote((string)$v);
                        }
                    }
                    $batch[] = '(' . implode(',', $vals) . ')';
                    if (count($batch) >= 250) {
                        $emit($colHeader . implode(",\n", $batch) . ";\n");
                        $batch = [];
                    }
                }
                if ($batch) {
                    $emit($colHeader . implode(",\n", $batch) . ";\n");
                }
                if ($colHeader !== '') $emit("\n");
                if ($drv === 'mysql') $p->setAttribute(defined('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY') ? constant('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY') : 1000, true);
            }
        }
        foreach ($viewsQueue as $vSql) $emit($vSql);

        if ($wantStruct) {
            if ($drv === 'sqlite') {
                $tPlace = $tables ? ' AND tbl_name IN (' . implode(',', array_map(fn($t) => $p->quote((string)$t), $tables)) . ')' : '';
                foreach (rows($p, "SELECT name, sql FROM sqlite_master WHERE type='trigger'$tPlace ORDER BY name") as $tr) {
                    if (!empty($tr['sql'])) {
                        $emit("-- Trigger: {$tr['name']}\nDROP TRIGGER IF EXISTS " . q($tr['name'], 'sqlite') . ";\n{$tr['sql']};\n\n");
                    }
                }
            } else {
                $tPlace = $tables ? ' AND EVENT_OBJECT_TABLE IN (' . implode(',', array_map(fn($t) => $p->quote((string)$t), $tables)) . ')' : '';
                foreach (rows($p, "SELECT TRIGGER_NAME name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?$tPlace ORDER BY TRIGGER_NAME", [$db]) as $tr) {
                    $qt = q((string)$db, 'mysql') . '.' . q($tr['name'], 'mysql');
                    $csql = rows($p, "SHOW CREATE TRIGGER $qt")[0]['SQL Original Statement'] ?? '';
                    if ($csql !== '') {
                        $emit("-- Trigger: {$tr['name']}\nDROP TRIGGER IF EXISTS $qt;\n$csql;\n\n");
                    }
                }
                if (!empty($in['routines'])) {
                    foreach (rows($p, 'SELECT ROUTINE_NAME name, ROUTINE_TYPE type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME', [$db]) as $rt) {
                        $type = strtoupper($rt['type']) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
                        $qr = q((string)$db, 'mysql') . '.' . q($rt['name'], 'mysql');
                        $rowR = rows($p, "SHOW CREATE $type $qr")[0] ?? [];
                        $rsql = $rowR['Create ' . ucfirst(strtolower($type))] ?? '';
                        if ($rsql !== '') {
                            $emit("-- $type: {$rt['name']}\nDROP $type IF EXISTS $qr;\n$rsql;\n\n");
                        }
                    }
                }
            }
        }
        $emit($drv === 'mysql' ? "SET FOREIGN_KEY_CHECKS=1;\n" : "PRAGMA foreign_keys=ON;\n");

        if ($stream) {
            if ($comp === 'gzip') {
                header_remove('Content-Type');
                header('Content-Type: application/gzip');
                header('Content-Disposition: attachment; filename="' . $baseName . '.gz"');
                echo gzencode($buf, 6);
                exit;
            }
            if ($comp === 'zip') {
                header_remove('Content-Type');
                header('Content-Type: application/zip');
                header('Content-Disposition: attachment; filename="' . $baseName . '.zip"');
                echo build_single_file_zip($baseName, $buf);
                exit;
            }
            fclose($fh);
            exit;
        }
        out(['sql' => $buf]);

    case 'users':
        $isAdmin = is_full_admin($p, $drv, $c);
        $locks = load_locks();
        if ($drv === 'sqlite') {
            $uList = [];
            foreach (array_keys($cfg['sqlite_users']) as $su) {
                $lk = $locks['accounts']['sqlite:' . $su] ?? null;
                $uList[] = [
                    'user' => $su,
                    'host' => 'sqlite-sandbox',
                    'scopes' => [['db' => '*', 'table' => '*', 'privs' => ['ALL'], 'all' => true, 'option' => true, 'columns' => [], 'other' => []]],
                    'fandejo_locked' => !empty($lk['locked']),
                    'failed_attempts' => (int)($lk['attempts'] ?? 0),
                    'last_failed' => $lk['last_failed'] ?? null,
                    'last_ip' => $lk['last_ip'] ?? null,
                    'by_ip' => array_values($lk['by_ip'] ?? []),
                    'db_locked' => false,
                ];
            }
            out(['users' => $uList, 'me' => $c['user'], 'is_admin' => true, 'lockouts' => $locks, 'max_login_attempts' => $cfg['max_login_attempts'], 'admin_lockout_seconds' => $cfg['admin_lockout_seconds']]);
        }
        $dbLocks = [];
        $sysUsersSql = implode(',', array_map(fn($u) => $p->quote($u), DB_SYSTEM_USERS));
        try {
            foreach (rows($p, "SELECT User user, Host host, account_locked locked FROM mysql.user WHERE User NOT IN ($sysUsersSql)") as $lr) {
                $dbLocks[$lr['user'] . '@' . $lr['host']] = strtoupper((string)($lr['locked'] ?? 'N')) === 'Y';
            }
        } catch (Throwable) {
            // MariaDB fallback: check account_locked in mysql.global_priv JSON Priv column
            try {
                foreach (rows($p, "SELECT User user, Host host, Priv priv FROM mysql.global_priv WHERE User NOT IN ($sysUsersSql)") as $lr) {
                    $pj = json_decode((string)($lr['priv'] ?? '{}'), true);
                    $dbLocks[$lr['user'] . '@' . $lr['host']] = !empty($pj['account_locked']);
                }
            } catch (Throwable) {}
        }
        $r = rows($p, "SELECT User user, Host host FROM mysql.user WHERE User NOT IN ($sysUsersSql) ORDER BY 1,2");
        foreach ($r as &$u) {
            try { $u['scopes'] = parse_grants($p, $u['user'], $u['host']); } catch (Throwable $e) { $u['scopes'] = []; }
            $lk = $locks['accounts']['mysql:' . $u['user']] ?? null;
            $u['fandejo_locked'] = !empty($lk['locked']);
            $u['failed_attempts'] = (int)($lk['attempts'] ?? 0);
            $u['last_failed'] = $lk['last_failed'] ?? null;
            $u['last_ip'] = $lk['last_ip'] ?? null;
            $u['by_ip'] = array_values($lk['by_ip'] ?? []);
            $u['db_locked'] = !empty($dbLocks[$u['user'] . '@' . $u['host']]);
        }
        out(['users' => $r, 'me' => $c['user'], 'is_admin' => $isAdmin, 'lockouts' => $isAdmin ? $locks : ['accounts' => [], 'ips' => []], 'max_login_attempts' => $cfg['max_login_attempts'], 'admin_lockout_seconds' => $cfg['admin_lockout_seconds']]);

    case 'lockouts':
        if (!is_full_admin($p, $drv, $c)) fail('Administrator privileges required to view lockouts', 403);
        out(['lockouts' => load_locks(), 'max_login_attempts' => $cfg['max_login_attempts'], 'admin_lockout_seconds' => $cfg['admin_lockout_seconds']]);

    case 'unlock_account':
        if (!is_full_admin($p, $drv, $c)) fail('Full administrator privileges required to unlock accounts', 403);
        $locks = load_locks();
        $targetUser = trim((string)($in['user'] ?? ''));
        $targetDrv = strtolower(trim((string)($in['driver'] ?? $drv)));
        $targetHost = trim((string)($in['host'] ?? ''));
        $targetIp = trim((string)($in['ip'] ?? ''));

        if (!empty($in['clear_all'])) {
            $locks = ['accounts' => [], 'ips' => []];
            save_locks($locks);
            out(['ok' => true]);
        }
        if ($targetUser !== '' && $targetIp !== '') {
            // Unlock a specific (account, IP) slot
            $acctKey = $targetDrv . ':' . $targetUser;
            unset($locks['accounts'][$acctKey]['by_ip'][$targetIp], $locks['ips'][$targetIp]);
            if (empty($locks['accounts'][$acctKey]['by_ip']) && empty($locks['accounts'][$acctKey]['global_locked'])) {
                unset($locks['accounts'][$acctKey]);
            } elseif (isset($locks['accounts'][$acctKey])) {
                recompute_acct_lock_summary($locks['accounts'][$acctKey]);
            }
            save_locks($locks);
            out(['ok' => true]);
        }
        if ($targetIp !== '') {
            unset($locks['ips'][$targetIp]);
            save_locks($locks);
            out(['ok' => true]);
        }
        if ($targetUser !== '') {
            $acctKey = $targetDrv . ':' . $targetUser;
            foreach (array_keys($locks['accounts'][$acctKey]['by_ip'] ?? []) as $lip) {
                unset($locks['ips'][$lip]);
            }
            unset($locks['accounts'][$acctKey]);
            save_locks($locks);
        }
        if ($drv === 'mysql' && !empty($in['db_unlock']) && $targetUser !== '' && $targetHost !== '') {
            $p->exec('ALTER USER ' . acct_sql($p, $targetUser, $targetHost) . ' ACCOUNT UNLOCK');
        }
        if ($drv === 'mysql' && !empty($in['db_lock']) && $targetUser !== '' && $targetHost !== '') {
            $p->exec('ALTER USER ' . acct_sql($p, $targetUser, $targetHost) . ' ACCOUNT LOCK');
        }
        out(['ok' => true]);

    case 'user_grants':
        if ($drv !== 'mysql') fail('MySQL only');
        out(['scopes' => parse_grants($p, $in['user'], $in['host']), 'catalog' => ['global' => PRIV_GLOBAL, 'db' => PRIV_DB, 'table' => PRIV_TABLE]]);

    case 'set_grants':
        if ($drv !== 'mysql') fail('MySQL only');
        $sdb = (string)($in['scope_db'] ?? '*'); $stb = (string)($in['scope_table'] ?? '*');
        if ($sdb === '*') $stb = '*';
        $cat = priv_catalog($sdb, $stb);
        $want = array_values(array_unique(array_map('strtoupper', $in['privileges'] ?? [])));
        if (array_diff($want, $cat)) fail('Unknown privilege: ' . implode(', ', array_diff($want, $cat)));
        $wantOpt = !empty($in['grant_option']);
        $cur = ['privs' => [], 'option' => false];
        foreach (parse_grants($p, $in['user'], $in['host']) as $e) if ($e['db'] === $sdb && $e['table'] === $stb) $cur = $e;
        $add = array_values(array_diff($want, $cur['privs'])); $del = array_values(array_intersect($cur['privs'], array_diff($cat, $want)));
        $T2 = scope_sql($sdb, $stb); $acct = acct_sql($p, $in['user'], $in['host']); $st = [];
        if ($del) $st[] = 'REVOKE ' . implode(', ', $del) . " ON $T2 FROM $acct";
        if ($add) $st[] = 'GRANT ' . (count($add) === count($cat) ? 'ALL PRIVILEGES' : implode(', ', $add)) . " ON $T2 TO $acct";
        if ($wantOpt && !$cur['option']) $st[] = "GRANT USAGE ON $T2 TO $acct WITH GRANT OPTION";
        if (!$wantOpt && $cur['option']) $st[] = "REVOKE GRANT OPTION ON $T2 FROM $acct";
        if (empty($in['dry'])) foreach ($st as $x) $p->exec($x);
        out(['ok' => true, 'statements' => $st]);

    case 'set_password':
        if (($in['pass'] ?? '') === '') fail('Password required');
        if ($drv === 'sqlite') {
            if (strlen((string)$in['pass']) < 6) fail('Password must be at least 6 characters');
            $targetUser = trim((string)($in['user'] ?? ''));
            if ($targetUser === '' || !isset($cfg['sqlite_users'][$targetUser])) fail('SQLite user not found');
            $users = $cfg['sqlite_users'];
            $users[$targetUser] = password_hash((string)$in['pass'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
            save_sqlite_config($cfg['sqlite_dirs'], $users);
            if ($targetUser === $c['user']) $_SESSION['c']['sealed_pass'] = seal_secret((string)$in['pass']);
            out(['ok' => true]);
        }
        if ($drv === 'mysql' && in_array(strtolower(trim((string)($in['user'] ?? ''))), DB_SYSTEM_USERS, true)) {
            fail('Cannot modify internal database system account', 403);
        }
        $p->exec('ALTER USER ' . acct_sql($p, $in['user'], $in['host']) . ' IDENTIFIED BY ' . $p->quote($in['pass'])); out(['ok' => true]);

    case 'create_user':
        $newUser = trim((string)($in['user'] ?? ''));
        if ($newUser === '') fail('Username is required');
        if ($drv === 'sqlite') {
            if (strlen((string)($in['pass'] ?? '')) < 6) fail('Password must be at least 6 characters');
            $users = $cfg['sqlite_users'];
            if (isset($users[$newUser])) fail("SQLite user '$newUser' already exists");
            $users[$newUser] = password_hash((string)$in['pass'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
            save_sqlite_config($cfg['sqlite_dirs'], $users);
            out(['ok' => true]);
        }
        $p->exec('CREATE USER ' . $p->quote($newUser) . '@' . $p->quote($in['host'] ?? '%') . ' IDENTIFIED BY ' . $p->quote($in['pass']));
        if (!empty($in['grant_db'])) $p->exec('GRANT ALL PRIVILEGES ON ' . q($in['grant_db'], 'mysql') . '.* TO ' . $p->quote($newUser) . '@' . $p->quote($in['host'] ?? '%'));
        out(['ok' => true]);
    case 'drop_user':
        if ($drv === 'sqlite') {
            $targetUser = trim((string)($in['user'] ?? ''));
            $users = $cfg['sqlite_users'];
            if (!isset($users[$targetUser])) fail('SQLite user not found');
            if (count($users) <= 1) fail('Cannot delete the only SQLite administrator account');
            unset($users[$targetUser]);
            save_sqlite_config($cfg['sqlite_dirs'], $users);
            out(['ok' => true]);
        }
        if ($drv === 'mysql' && in_array(strtolower(trim((string)($in['user'] ?? ''))), DB_SYSTEM_USERS, true)) {
            fail('Cannot drop internal database system account', 403);
        }
        $p->exec('DROP USER ' . $p->quote($in['user']) . '@' . $p->quote($in['host'])); out(['ok' => true]);

    default: fail('Unknown action', 404);
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 400);
}
