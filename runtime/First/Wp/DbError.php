<?php

declare(strict_types=1);

namespace First\Wp;

/** A MySQL error from a statement First ran on the WordPress connection (errno = server error code). */
final class DbError extends \RuntimeException
{
}
