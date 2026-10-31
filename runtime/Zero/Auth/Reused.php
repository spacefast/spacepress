<?php

declare(strict_types=1);

namespace Zero\Auth;

use Zero\HttpError;

/**
 * A reused refresh token: the family revocation must commit even though the request fails, so the
 * route catches this inside the transaction and returns the wrapped 401 instead of rethrowing.
 */
final class Reused extends \RuntimeException
{
    public function __construct(public readonly HttpError $error)
    {
        parent::__construct($error->getMessage());
    }
}
