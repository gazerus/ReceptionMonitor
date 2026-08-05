<?php
/**
 * Optional, recommended-for-production access control.
 *
 * The MVP viewer gates access with a client-side email check against
 * allowlist.json (see packages/shared/src/config.default.json) — good
 * enough to keep casual visitors out, but not real security since the
 * check runs in the browser.
 *
 * This script does the real check server-side and mints a scoped Daily.co
 * meeting token, which Daily will actually enforce. It's a stateless PHP
 * script, so it runs fine on ordinary shared cPanel hosting (no persistent
 * process needed) — the same hosting the spec ruled out for a raw WebRTC
 * signaling server is perfectly adequate for this.
 *
 * Deploy: drop this file (plus config.json + secrets.php, both outside the
 * public webroot if your host allows it) on the existing site, point the
 * viewer app at it, and have the viewer call it to get a token *before*
 * calling call.join({ url, token }).
 *
 * Wiring it into the viewer app is left for a follow-up once hosting
 * details and the Daily account are confirmed.
 */

declare(strict_types=1);

header('Content-Type: application/json');

// secrets.php is NOT committed to the repo — see server/secrets.example.php.
// It must define DAILY_API_KEY (from the Daily.co dashboard) and ROOM_NAME.
require_once __DIR__ . '/secrets.php';

function fail(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
$email = is_array($body) ? ($body['email'] ?? '') : '';

if (!is_string($email) || $email === '') {
    fail(400, 'Missing email');
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

$ch = curl_init('https://api.daily.co/v1/meeting-tokens');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . DAILY_API_KEY,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'properties' => [
            'room_name' => ROOM_NAME,
            'is_owner' => false,
            'user_name' => $email,
            'enable_screenshare' => false,
            // Viewer starts muted/camera-off; the client still flips these
            // locally when the Talk button is pressed.
            'start_audio_off' => true,
            'start_video_off' => true,
        ],
    ]),
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false || $httpCode >= 300) {
    fail(502, 'Failed to mint Daily token');
}

$decoded = json_decode((string) $response, true);
echo json_encode(['token' => $decoded['token'] ?? null]);
