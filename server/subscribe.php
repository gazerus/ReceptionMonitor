<?php
/**
 * Stores a viewer's Web Push subscription so notify-doorbell.php has
 * somewhere to send to. Stateless script, fine on ordinary shared cPanel
 * hosting -- same reasoning as mint-token.php.
 *
 * Subscriptions are keyed by email and checked against the same allowlist
 * used everywhere else (config.json), so this doesn't become a way to
 * register arbitrary strangers for notifications.
 */

declare(strict_types=1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function fail(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
$email = is_array($body) ? ($body['email'] ?? '') : '';
$subscription = is_array($body) ? ($body['subscription'] ?? null) : null;

if (!is_string($email) || $email === '' || !is_array($subscription)) {
    fail(400, 'Missing email or subscription');
}

$configPath = __DIR__ . '/config.json';
if (!is_file($configPath)) {
    fail(500, 'Server misconfigured: config.json not found');
}
$config = json_decode((string) file_get_contents($configPath), true);
$allowlist = array_map(
    fn($e) => strtolower(trim($e)),
    $config['allowlist']['viewers'] ?? []
);

if (!in_array(strtolower(trim($email)), $allowlist, true)) {
    fail(403, 'Not authorized');
}

$storePath = __DIR__ . '/push-subscriptions.json';
$store = is_file($storePath) ? json_decode((string) file_get_contents($storePath), true) : [];
if (!is_array($store)) {
    $store = [];
}

$store[strtolower(trim($email))] = $subscription;

file_put_contents($storePath, json_encode($store, JSON_PRETTY_PRINT));

echo json_encode(['ok' => true]);
