<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

use SpacePress\Crypto;
use SpacePress\Env;
use SpacePress\HttpError;
use SpacePress\JsError;
use SpacePress\Node\Module;

$crypto = Module::get('crypto');
/** `createHash(algorithm).update(...parts).digest(encoding)` through the module object. */
$hash = static function (string $algorithm, array $parts, string $encoding) use ($crypto): string {
    $h = $crypto->call('createHash', [$algorithm]);
    foreach ($parts as $part) { $h->update($part); }
    return $h->digest($encoding);
};
$hmac = static function (string $algorithm, mixed $key, array $parts, string $encoding) use ($crypto): string {
    $h = $crypto->call('createHmac', [$algorithm, $key]);
    foreach ($parts as $part) { $h->update($part); }
    return $h->digest($encoding);
};

// Published test vectors, plus the other digests.
eq('SHA-256 of "abc" is the FIPS 180-2 B.1 digest', $hash('sha256', ['abc'], 'hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
eq('digests are over the UTF-8 bytes of every update, in hex, base64 or base64url',
    [$hash('sha1', ['abc'], 'hex'), $hash('md5', [''], 'hex'), substr($hash('SHA512', ['abc'], 'hex'), 0, 16),
        substr($hash('sha384', ['abc'], 'hex'), 0, 16), $hash('sha256', ['é'], 'hex'),
        $hash('sha256', ['a', 'bc'], 'base64'), $hash('sha256', ['abc'], 'base64url')],
    ['a9993e364706816aba3e25717850c26c9cd0d89d', 'd41d8cd98f00b204e9800998ecf8427e', 'ddaf35a193617aba',
        'cb00753f45a35e8b', hash('sha256', "\xc3\xa9"), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
        'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0']);

Env::isolate(['WEBHOOK_SECRET' => " Jefe \n", 'EMPTY_SECRET' => '  ']);
eq('HMAC matches RFC 4231 cases 1 and 2, with a key as given and a key read from process.env (trimmed)',
    [
        $hmac('sha256', str_repeat("\x0b", 20), ['Hi There'], 'hex'),
        $hmac('sha256', Crypto::envKey('WEBHOOK_SECRET'), ['what do ya ', 'want for nothing?'], 'hex'),
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
        return $e->jsName . ($e->node_code === null ? '' : ' ' . $e->node_code) . ': ' . $e->getMessage();
    }
};
eq('a missing or blank process.env key is crypto_key_unavailable; bad inputs throw as Node does',
    [
        $code(fn () => Crypto::envKey('MISSING')),
        $code(fn () => Crypto::envKey('EMPTY_SECRET')),
        $code(fn () => $hash('whirlpool', ['x'], 'hex')),
        $code(fn () => $crypto->call('createHash', ['sha256'])->update(null)),
        $code(fn () => $hash('sha256', [str_repeat('x', Crypto::MAX_DATA), 'x'], 'hex')),
        // A key is capped like the data it signs.
        $code(fn () => $hmac('sha256', str_repeat('k', Crypto::MAX_DATA + 1), ['x'], 'hex')),
    ],
    ['crypto_key_unavailable', 'crypto_key_unavailable', 'Error: Digest method not supported',
        'TypeError ERR_INVALID_ARG_TYPE: The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView',
        'crypto_input_too_large', 'crypto_input_too_large']);
eq('a key at the cap still signs', strlen($hmac('sha256', str_repeat('k', Crypto::MAX_DATA), ['x'], 'hex')), 64);
Env::isolate([]);

$from = static fn (string $text) => Module::get('buffer')->member('Buffer')->invoke('from', [$text]);
eq('timingSafeEqual compares bytes and throws on different byte lengths, as Node does', [
    $crypto->call('timingSafeEqual', [$from('abc'), $from('abc')]), $crypto->call('timingSafeEqual', [$from('abc'), $from('abd')]),
    $code(fn () => $crypto->call('timingSafeEqual', [$from('é'), $from('e')])),
    $code(fn () => $crypto->call('timingSafeEqual', ['a', 'a'])),
], [true, false, 'RangeError ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH: Input buffers must have the same byte length',
    'TypeError ERR_INVALID_ARG_TYPE: The "buf1" argument must be an ArrayBuffer or view']);

$uuid = Crypto::randomUUID();
$random = static fn (mixed $n) => $crypto->call('randomBytes', [$n]);
eq('randomUUID is RFC 4122 version 4; randomBytes is a Buffer of the asked length, 0 to 1024',
    [preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $uuid), $random(16)->length,
        $random(8)->bytes() === $random(8)->bytes(), $random(0)->length, $random(9)->node_buffer,
        $code(fn () => $random(1025)), $code(fn () => $random('1'))],
    [1, 16, false, 0, true, 'RangeError: randomBytes takes 0 to 1024 bytes in SpacePress code',
        'TypeError ERR_INVALID_ARG_TYPE: The "size" argument must be number']);

// A native OpenSSL string can be a file URI. Compiled Node calls accept in-memory data only.
$key_file = tmpfile();
openssl_pkey_export(openssl_pkey_new(['private_key_bits' => 1024, 'private_key_type' => OPENSSL_KEYTYPE_RSA]), $fixture_key);
fwrite($key_file, $fixture_key);
$fixture_uri = 'file://' . stream_get_meta_data($key_file)['uri'];
eq('KeyObject imports refuse file URIs', [
    $code(fn () => $crypto->call('createPrivateKey', [$fixture_uri])),
    $code(fn () => $crypto->call('createPublicKey', [new \SpacePress\JsObject(['key' => $fixture_uri, 'format' => 'pem'])])),
], [
    'Error ERR_OSSL_UNSUPPORTED: Expected an in-memory PEM key',
    'Error ERR_OSSL_UNSUPPORTED: Expected an in-memory PEM key',
]);
fclose($key_file);

eq('a digest is finalized once, as in Node', $code(function () use ($crypto) {
    $h = $crypto->call('createHash', ['sha256']);
    $h->digest();
    $h->digest();
}), 'Error ERR_CRYPTO_HASH_FINALIZED: Digest already called');

finish('crypto');
