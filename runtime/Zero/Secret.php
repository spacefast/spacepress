<?php
declare(strict_types=1);
namespace Zero;

/** Persistent standalone signing key. Deployment configuration takes precedence. */
final class Secret
{
    public static function load(string $root): string
    {
        $configured = getenv('ZERO_SECRET');
        if ($configured !== false && $configured !== '') {
            return $configured;
        }
        $directory = $root . '/data';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new \RuntimeException('Cannot create the standalone data directory');
        }
        $file = fopen($directory . '/secret', 'c+');
        if ($file === false) {
            throw new \RuntimeException('Cannot open the standalone signing key');
        }
        try {
            if (!flock($file, LOCK_EX) || !chmod($directory . '/secret', 0600)) {
                throw new \RuntimeException('Cannot protect the standalone signing key');
            }
            $secret = stream_get_contents($file);
            if ($secret === '') {
                $secret = bin2hex(random_bytes(32));
                if (fwrite($file, $secret) !== 64 || !fflush($file)) {
                    throw new \RuntimeException('Cannot persist the standalone signing key');
                }
            }
            if (!is_string($secret) || !preg_match('/^[0-9a-f]{64}$/D', $secret)) {
                throw new \RuntimeException('Invalid data/secret; restore the signing key or set ZERO_SECRET');
            }
            return $secret;
        } finally {
            fclose($file);
        }
    }
}
