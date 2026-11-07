<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\Crypto;
use Zero\Env;
use Zero\HttpError;
use Zero\JsError;
use Zero\JsObject;

// The vectors the original runtime's crypto broker pins (crypto.rs tests), plus SHA-1/512/MD5.
eq('SHA-256 of "abc" is the FIPS 180-2 B.1 digest', Crypto::sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
eq('other digests are lowercase hex over UTF-8 bytes',
    [Crypto::sha1('abc'), Crypto::md5(''), substr(Crypto::sha512('abc'), 0, 16), Crypto::sha256('é')],
    ['a9993e364706816aba3e25717850c26c9cd0d89d', 'd41d8cd98f00b204e9800998ecf8427e', 'ddaf35a193617aba',
        hash('sha256', "\xc3\xa9")]);

Env::isolate(['WEBHOOK_SECRET' => " Jefe \n", 'EMPTY_SECRET' => '  ']);
eq('HMAC-SHA-256 matches RFC 4231 cases 1 and 2, inline and by variable name (trimmed)',
    [
        Crypto::hmacSha256(new JsObject(['key' => new JsObject(['value' => str_repeat("\x0b", 20)]), 'data' => 'Hi There'])),
        Crypto::hmacSha256(new JsObject(['key' => 'WEBHOOK_SECRET', 'data' => 'what do ya want for nothing?'])),
    ],
    ['b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843']);
$code = static function (callable $f): string {
    try {
        $f();
        return 'ok';
    } catch (HttpError $e) {
        return $e->errorCode;
    } catch (JsError $e) {
        return $e->getMessage();
    }
};
eq('a missing or blank named key is crypto_key_unavailable; malformed options are TypeErrors',
    [
        $code(fn () => Crypto::hmacSha256(new JsObject(['key' => 'MISSING', 'data' => 'x']))),
        $code(fn () => Crypto::hmacSha256(new JsObject(['key' => 'EMPTY_SECRET', 'data' => 'x']))),
        $code(fn () => Crypto::hmacSha256(new JsObject(['key' => 'K', 'data' => 'x', 'extra' => 1]))),
        $code(fn () => Crypto::hmacSha256(new JsObject(['key' => new JsObject(['value' => 1]), 'data' => 'x']))),
        $code(fn () => Crypto::sha256(str_repeat('x', Crypto::MAX_DATA + 1))),
        // An inline { value } key is capped like the data it signs.
        $code(fn () => Crypto::hmacSha256(new JsObject(['key' => new JsObject(['value' => str_repeat('k', Crypto::MAX_DATA + 1)]), 'data' => 'x']))),
    ],
    ['crypto_key_unavailable', 'crypto_key_unavailable', 'crypto.hmacSha256 takes { key, data }',
        'crypto.hmacSha256 key must be a variable name or { value }', 'crypto_input_too_large', 'crypto_input_too_large']);
eq('an inline key at the cap still signs', strlen(Crypto::hmacSha256(new JsObject(['key' => new JsObject(['value' => str_repeat('k', Crypto::MAX_DATA)]), 'data' => 'x']))), 64);
Env::isolate([]);

eq('timingSafeEqual compares whole values', [
    Crypto::timingSafeEqual('abc', 'abc'), Crypto::timingSafeEqual('abc', 'abd'), Crypto::timingSafeEqual('abc', 'abcd'),
], [true, false, false]);

$uuid = Crypto::randomUUID();
eq('randomUUID is RFC 4122 version 4 and randomHex has the asked length',
    [preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $uuid), strlen(Crypto::randomHex(16)),
        Crypto::randomHex(8) === Crypto::randomHex(8), $code(fn () => Crypto::randomHex(0)), $code(fn () => Crypto::randomHex(1.5))],
    [1, 32, false, 'crypto.randomHex takes 1 to 1024 bytes', 'crypto.randomHex needs a whole number of bytes']);

// Byte-for-byte with the original runtime over mixed Unicode inputs (crypto-parity/README.md).
$expected = json_decode(file_get_contents(__DIR__ . '/crypto-parity/expected.json'), true);
$inline = [];
foreach (json_decode(file_get_contents(__DIR__ . '/crypto-parity/cases.json'), true) as [$k, $d]) {
    $key = new JsObject(['value' => preg_replace('/\A[\x{9}-\x{D}\x{20}\x{85}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]+|[\x{9}-\x{D}\x{20}\x{85}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]+\z/u', '', $k)]);
    $inline[] = [Crypto::sha256($d), Crypto::hmacSha256(new JsObject(['key' => $key, 'data' => $d])), Crypto::timingSafeEqual($k, $d)];
}
eq('inline keys match the original runtime on ' . count($inline) . ' cases', $inline, $expected['inline']);
$named = [];
foreach (json_decode(file_get_contents(__DIR__ . '/crypto-parity/named.json'), true) as [$k, $d]) {
    Env::isolate(['K' => $k]);
    $named[] = [Crypto::sha256($d), Crypto::hmacSha256(new JsObject(['key' => 'K', 'data' => $d])), Crypto::timingSafeEqual($k, $d)];
}
Env::isolate([]);
eq('named keys are trimmed like the original keyring on ' . count($named) . ' cases', $named, $expected['named']);

finish('crypto');
