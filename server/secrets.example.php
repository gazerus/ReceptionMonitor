<?php
// Copy to secrets.php (gitignored) and fill in real values.
// Never commit the real secrets.php file.

define('DAILY_API_KEY', 'paste-your-daily-api-key-here');
define('ROOM_NAME', 'reception');

// Generate once with: npx web-push generate-vapid-keys
// Public key also goes in the hosted config.json (push.vapidPublicKey) --
// it's not sensitive, only the private key needs to stay server-side.
define('VAPID_PUBLIC_KEY', 'paste-generated-vapid-public-key-here');
define('VAPID_PRIVATE_KEY', 'paste-generated-vapid-private-key-here');
define('VAPID_SUBJECT', 'mailto:you@example.com');

// Must match config.json's push.notifySecret exactly -- basic gate so
// notify-doorbell.php isn't a fully open URL. Any random string works.
define('DOORBELL_SHARED_SECRET', 'paste-a-random-string-here');
