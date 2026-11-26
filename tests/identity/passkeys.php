<?php
// Passkeys through the real WebAuthn validator, with a software ES256 authenticator (no browser):
// registration, assertion, assertion replay, a foreign origin and a removed credential.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Passkeys};

ob_start(); // options() sets the binding cookie as a browser response would.
$b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
$unb64 = static fn (string $s): string => base64_decode(strtr($s, '-_', '+/'), true);
// Minimal CBOR: unsigned/negative ints, byte/text strings and maps are all an authenticator needs.
$cbor = static function (mixed $v) use (&$cbor): string {
    $head = static function (int $major, int $n): string {
        return match (true) {
            $n < 24 => chr($major << 5 | $n),
            $n < 256 => chr($major << 5 | 24) . chr($n),
            default => chr($major << 5 | 25) . pack('n', $n),
        };
    };
    if (is_int($v)) {
        return $v >= 0 ? $head(0, $v) : $head(1, -1 - $v);
    }
    if (is_array($v)) { // a map, as a list of [key, value] pairs
        $out = $head(5, count($v));
        foreach ($v as [$k, $item]) {
            $out .= $cbor($k) . $cbor($item);
        }
        return $out;
    }
    [$kind, $s] = $v instanceof stdClass ? ['text', $v->text] : ['bytes', $v];
    return $head($kind === 'text' ? 3 : 2, strlen($s)) . $s;
};
$text = static fn (string $s): stdClass => (object) ['text' => $s];

$host = wp_parse_url(home_url(), PHP_URL_HOST);
$origin = untrailingslashit(home_url());
$key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
$ec = openssl_pkey_get_details($key)['ec'];
$credentialId = random_bytes(32);
$cose = $cbor([[1, 2], [3, -7], [-1, 1], [-2, str_pad($ec['x'], 32, "\0", STR_PAD_LEFT)], [-3, str_pad($ec['y'], 32, "\0", STR_PAD_LEFT)]]);
$counter = 0;
$authData = static function (bool $attested) use ($host, $credentialId, $cose, &$counter): string {
    $counter++;
    $flags = 0x01 | 0x04 | ($attested ? 0x40 : 0); // user present, user verified, attested data
    return hash('sha256', $host, true) . chr($flags) . pack('N', $counter)
        . ($attested ? str_repeat("\0", 16) . pack('n', strlen($credentialId)) . $credentialId . $cose : '');
};
$client = static fn (string $type, string $challenge, string $from) => json_encode(['type' => $type, 'challenge' => $challenge, 'origin' => $from, 'crossOrigin' => false], JSON_UNESCAPED_SLASHES);

$tag = bin2hex(random_bytes(4));
$uid = Plugin::$accounts->emailLogin("passkey-$tag@example.test");
$session = Plugin::$sessions->create($uid)['session'];
$passkeys = new Passkeys(Plugin::$db, Plugin::$security);
$bind = static function (string $challengeId): void {
    // options() sent its binding in a cookie the CLI can't read back; give the challenge a
    // known binding and present it the way the browser would.
    $_COOKIE['zi_passkey'] = \SpacePress\Identity\Security::token();
    Plugin::$db->run('UPDATE ' . Plugin::$db->prefix . 'challenges SET secret_hash=%s WHERE id=%s', \SpacePress\Identity\Security::hash($_COOKIE['zi_passkey']), $challengeId);
};

$options = $passkeys->options($session);
$bind($options['challenge_id']);
$clientData = $client('webauthn.create', $options['options']['challenge'], $origin);
$attestation = $cbor([[$text('fmt'), $text('none')], [$text('attStmt'), []], [$text('authData'), $authData(true)]]);
$passkeys->finish($options['challenge_id'], [
    'id' => $b64($credentialId), 'rawId' => $b64($credentialId), 'type' => 'public-key',
    'response' => ['clientDataJSON' => $b64($clientData), 'attestationObject' => $b64($attestation)],
], $session);
check((bool) Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . 'passkeys WHERE wp_user_id=%d', $uid), 'a verified attestation registers the passkey');

$assert = static function (string $from) use ($passkeys, $bind, $client, $authData, $b64, $credentialId, $key, $uid): array {
    $options = $passkeys->options(null);
    $bind($options['challenge_id']);
    $data = $authData(false);
    $clientData = $client('webauthn.get', $options['options']['challenge'], $from);
    openssl_sign($data . hash('sha256', $clientData, true), $signature, $key, OPENSSL_ALGO_SHA256);
    return [$options['challenge_id'], [
        'id' => $b64($credentialId), 'rawId' => $b64($credentialId), 'type' => 'public-key',
        'response' => ['clientDataJSON' => $b64($clientData), 'authenticatorData' => $b64($data), 'signature' => $b64($signature), 'userHandle' => $b64((string) $uid)],
    ]];
};
[$challenge, $credential] = $assert($origin);
check($passkeys->finish($challenge, $credential, null) === $uid, 'a signed assertion signs the account in');
rejects(fn () => $passkeys->finish($challenge, $credential, null), 'invalid_challenge', 'an assertion cannot be replayed');
[$challenge, $credential] = $assert('https://evil.example');
rejects(fn () => $passkeys->finish($challenge, $credential, null), 'invalid_passkey', 'an assertion made for another origin is refused');
Plugin::$db->run('DELETE FROM ' . Plugin::$db->prefix . 'passkeys WHERE wp_user_id=%d', $uid);
[$challenge, $credential] = $assert($origin);
rejects(fn () => $passkeys->finish($challenge, $credential, null), 'invalid_passkey', 'a removed passkey no longer signs in');
ob_end_flush();
