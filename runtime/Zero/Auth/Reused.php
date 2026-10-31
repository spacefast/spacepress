<?php

declare(strict_types=1);

namespace Zero\Auth;

use Zero\HttpError;

/**
 * A failed grant whose bookkeeping must commit even though the request fails (a reused refresh
 * token's family revocation, a failed password's throttle count): the route catches it inside the
 * transaction and returns the wrapped problem instead of rethrowing.
 */
class Reused extends \RuntimeException
{
    public function __construct(public readonly HttpError $error)
    {
        parent::__construct($error->getMessage());
    }
}
