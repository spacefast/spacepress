<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\Crypto;
use Zero\Env;
use Zero\HttpError;
use Zero\JsError;
use Zero\JsObject;

// The vectors the original runtime's crypto broker pins (crypto.rs tests), plus the other digests.
eq('SHA-256 of "abc" is the FIPS 180-2 B.1 digest', Crypto::hash('sha256', ['abc'], 'hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
eq('digests are over the UTF-8 bytes of every update, in hex, base64 or base64url',
    [Crypto::hash('sha1', ['abc'], 'hex'), Crypto::hash('md5', [''], 'hex'), substr(Crypto::hash('SHA512', ['abc'], 'hex'), 0, 16),
        substr(Crypto::hash('sha384', ['abc'], 'hex'), 0, 16), Crypto::hash('sha256', ['é'], 'hex'),
        Crypto::hash('sha256', ['a', 'bc'], 'base64'), Crypto::hash('sha256', ['abc'], 'base64url')],
    ['a9993e364706816aba3e25717850c26c9cd0d89d', 'd41d8cd98f00b204e9800998ecf8427e', 'ddaf35a193617aba',
        'cb00753f45a35e8b', hash('sha256', "\xc3\xa9"), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
        'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0']);

Env::isolate(['WEBHOOK_SECRET' => " Jefe \n", 'EMPTY_SECRET' => '  ']);
eq('HMAC matches RFC 4231 cases 1 and 2, with a key as given and a key read from process.env (trimmed)',
    [
        Crypto::hmac('sha256', str_repeat("\x0b", 20), ['Hi There'], 'hex'),
        Crypto::hmacEnv('sha256', 'WEBHOOK_SECRET', ['what do ya ', 'want for nothing?'], 'hex'),
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
        return $e->jsName . ': ' . $e->getMessage();
    }
};
eq('a missing or blank process.env key is crypto_key_unavailable; bad inputs throw as Node does',
    [
        $code(fn () => Crypto::hmacEnv('sha256', 'MISSING', ['x'], 'hex')),
        $code(fn () => Crypto::hmacEnv('sha256', 'EMPTY_SECRET', ['x'], 'hex')),
        $code(fn () => Crypto::hash('whirlpool', ['x'], 'hex')),
        $code(fn () => Crypto::hash('sha256', [null], 'hex')),
        $code(fn () => Crypto::hash('sha256', [str_repeat('x', Crypto::MAX_DATA), 'x'], 'hex')),
    ],
    ['crypto_key_unavailable', 'crypto_key_unavailable', 'Error: Digest method not supported',
        'TypeError: Hash.update needs a string', 'crypto_input_too_large']);
Env::isolate([]);

eq('timingSafeEqual compares UTF-8 bytes and throws on different byte lengths, as Node does', [
    Crypto::timingSafeEqual('abc', 'abc'), Crypto::timingSafeEqual('abc', 'abd'),
    $code(fn () => Crypto::timingSafeEqual('é', 'e')),
], [true, false, 'RangeError: Input buffers must have the same byte length']);

$uuid = Crypto::randomUUID();
eq('randomUUID is RFC 4122 version 4; randomBytes has the asked length in each encoding',
    [preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $uuid), strlen(Crypto::randomBytes(16, 'hex')),
        Crypto::randomBytes(8, 'hex') === Crypto::randomBytes(8, 'hex'), Crypto::randomBytes(0, 'base64'), strlen(Crypto::randomBytes(9, 'base64')),
        $code(fn () => Crypto::randomBytes(1025, 'hex')), $code(fn () => Crypto::randomBytes(1.5, 'hex'))],
    [1, 32, false, '', 12, 'RangeError: randomBytes takes 0 to 1024 bytes in Zero code', 'RangeError: The "size" argument must be a whole number']);

finish('crypto');
