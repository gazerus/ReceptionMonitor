<?php
/**
 * Called by the reception tablet when a visitor presses the doorbell
 * button. Sends a Web Push notification to every stored subscription
 * (see subscribe.php), so it reaches Garry's phone even if the viewer
 * page/tab isn't open.
 *
 * Requires the minishlink/web-push Composer package -- run `composer
 * install` in this directory once on the actual hosting.
 */

declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/secrets.php';

use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

function fail(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'POST only');
}

$providedSecret = $_SERVER['HTTP_X_DOORBELL_SECRET'] ?? '';
if (!hash_equals(DOORBELL_SHARED_SECRET, $providedSecret)) {
    fail(403, 'Not authorized');
}

$storePath = __DIR__ . '/push-subscriptions.json';
$store = is_file($storePath) ? json_decode((string) file_get_contents($storePath), true) : [];
if (!is_array($store) || count($store) === 0) {
    echo json_encode(['ok' => true, 'sent' => 0, 'note' => 'no subscriptions on file yet']);
    exit;
}

$webPush = new WebPush([
    'VAPID' => [
        'subject' => VAPID_SUBJECT,
        'publicKey' => VAPID_PUBLIC_KEY,
        'privateKey' => VAPID_PRIVATE_KEY,
    ],
]);

$payload = json_encode([
    'title' => 'SET Reception',
    'body' => 'Someone is at reception.',
]);

foreach ($store as $subscriptionData) {
    $webPush->queueNotification(Subscription::create($subscriptionData), $payload);
}

$sent = 0;
foreach ($webPush->flush() as $report) {
    if ($report->isSuccess()) {
        $sent++;
    } else {
        error_log('[doorbell] push failed for ' . $report->getEndpoint() . ': ' . $report->getReason());
    }
}

echo json_encode(['ok' => true, 'sent' => $sent]);
