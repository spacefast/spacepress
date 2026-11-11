<?php

namespace First\Vendor\AsyncAws\S3\Exception;

use First\Vendor\AsyncAws\Core\Exception\Http\ClientException;

/**
 * The specified key does not exist.
 */
final class NoSuchKeyException extends ClientException
{
}
