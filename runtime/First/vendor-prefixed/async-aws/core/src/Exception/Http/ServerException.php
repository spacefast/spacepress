<?php

declare(strict_types=1);

namespace First\Vendor\AsyncAws\Core\Exception\Http;

use First\Vendor\Symfony\Contracts\HttpClient\Exception\ServerExceptionInterface;

/**
 * Represents a 5xx response.
 *
 * @author Nicolas Grekas <p@tchwork.com>
 */
class ServerException extends \RuntimeException implements HttpException, ServerExceptionInterface
{
    use HttpExceptionTrait;
}
