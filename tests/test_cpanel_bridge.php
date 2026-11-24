<?php
/**
 * Automated Test Suite for Fandejo cPanel Integration
 */

declare(strict_types=1);

$pass = 0;
$fail = 0;

function assert_test(string $name, bool $condition, string $detail = ''): void {
    global $pass, $fail;
    if ($condition) {
        echo "  [\033[32mPASS\033[0m] {$name}\n";
        $pass++;
    } else {
        echo "  [\033[31mFAIL\033[0m] {$name}" . ($detail ? " — {$detail}" : '') . "\n";
        $fail++;
    }
}

echo "\n\033[36m=== Running Fandejo cPanel Integration Tests ===\033[0m\n\n";

// 1. Mock cPanel Environment
$mockUser = 'cpanel_test_user';
$mockHome = sys_get_temp_dir() . '/mock_cpanel_home_' . bin2hex(random_bytes(4));
mkdir($mockHome, 0755, true);
mkdir("{$mockHome}/public_html", 0755, true);

$_SERVER['REMOTE_USER'] = $mockUser;

require_once __DIR__ . '/../src/bridge.php';

// Override homeDir to mock home for testing
FandejoCpanelBridge::$homeDir = $mockHome;
FandejoCpanelBridge::$userFandejoDir = "{$mockHome}/.fandejo";
FandejoCpanelBridge::setupTenantStorage();

// Test 1: User Detection
assert_test("Detects cPanel remote user", FandejoCpanelBridge::detectUser() === $mockUser);

// Test 2: Multi-Tenant Storage Isolation
$tenantDir = "{$mockHome}/.fandejo";
assert_test("Creates isolated ~/.fandejo directory", is_dir($tenantDir));
$perms = substr(sprintf('%o', fileperms($tenantDir)), -4);
assert_test("Enforces 0700 permissions on ~/.fandejo", $perms === '0700', "Got: {$perms}");

// Test 3: Environment variable overrides
assert_test("Sets FANDEJO_CONFIG env", getenv('FANDEJO_CONFIG') === "{$tenantDir}/config.php");
assert_test("Sets FANDEJO_LOCKS_FILE env", getenv('FANDEJO_LOCKS_FILE') === "{$tenantDir}/locks.json");

// Test 4: Tenant Configuration File Generation
$cfgFile = "{$tenantDir}/config.php";
assert_test("Generates tenant config.php", file_exists($cfgFile));
$cfg = require $cfgFile;
assert_test("Config allows sqlite within tenant home", isset($cfg['sqlite_base_root']) && $cfg['sqlite_base_root'] === $mockHome);

// Test 5: Verify api.live.php syntax and headers
$apiOutput = shell_exec("php -r \"
    \\\$_SERVER['REMOTE_USER'] = '{$mockUser}';
    \\\$_GET['a'] = 'session';
    require '" . __DIR__ . "/../src/api.live.php';
\"");
$sessionData = json_decode((string)$apiOutput, true);
assert_test("api.live.php responds with valid JSON for a=session", is_array($sessionData));
assert_test("Session payload includes version", !empty($sessionData['version']));
assert_test("Session payload reports auth boolean", isset($sessionData['auth']));

// Clean up mock directory
shell_exec("rm -rf " . escapeshellarg($mockHome));

echo "\n\033[36m=================================================\033[0m\n";
echo "Results: \033[32m{$pass} passed\033[0m, " . ($fail > 0 ? "\033[31m{$fail} failed\033[0m" : "0 failed") . "\n";
echo "\033[36m=================================================\033[0m\n\n";

exit($fail > 0 ? 1 : 0);
