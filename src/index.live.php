<?php
/**
 * Fandejo LiveAPI Entrypoint for cPanel Jupiter Theme
 */

declare(strict_types=1);

require_once __DIR__ . '/bridge.php';

$user = FandejoCpanelBridge::detectUser();
$ssoData = FandejoCpanelBridge::attemptSocketSSO();

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fandejo — cPanel Database Workbench</title>
<link rel="icon" type="image/svg+xml" href="fandejo.svg">
<style>
/* System font stack fallback for isolated control panel environments */
body, button, input, select, textarea {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
code, pre, .font-mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
</style>
<link rel="stylesheet" href="style.css?v=cpanel-1">
<script>
window.FANDEJO_CPANEL = {
  user: <?= json_encode($user) ?>,
  homeDir: <?= json_encode(FandejoCpanelBridge::$homeDir) ?>,
  ssoAvailable: <?= $ssoData !== null ? 'true' : 'false' ?>
};
</script>
</head>
<body>
<div id="app"></div>
<div id="toasts"></div>
<dialog id="modal"></dialog>
<script type="module" src="app.js?v=cpanel-1"></script>
</body>
</html>
