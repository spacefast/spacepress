<?php

namespace First\Vendor\AsyncAws\S3\Exception;

use First\Vendor\AsyncAws\Core\Exception\Http\ClientException;

/**
 * The specified bucket does not exist.
 */
final class NoSuchBucketException extends ClientException
{
}
