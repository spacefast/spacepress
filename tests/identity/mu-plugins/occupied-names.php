<?php
// Test stack only: another plugin already owns the unprefixed library names. Identity must load
// its own Strauss-prefixed copies (TypedPress\Identity\Vendor\…) and never reach these stand-ins.
namespace Firebase\JWT { final class JWT { public static function encode(): never { throw new \LogicException('unprefixed php-jwt reached'); } } }
namespace OTPHP { final class TOTP { public static function generate(): never { throw new \LogicException('unprefixed otphp reached'); } } }
namespace Webauthn { final class PublicKeyCredential {} }
