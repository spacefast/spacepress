<?php

declare(strict_types=1);

namespace First\Vendor\AsyncAws\Core\Exception\Http;

use First\Vendor\AsyncAws\Core\Exception\Exception;
use First\Vendor\Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;

/**
 * Request could not be sent due network error.
 *
 * @author Tobias Nyholm <tobias.nyholm@gmail.com>
 */
class NetworkException extends \RuntimeException implements Exception, TransportExceptionInterface
{
}
