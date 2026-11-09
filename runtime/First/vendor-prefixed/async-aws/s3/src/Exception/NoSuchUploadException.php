<?php

namespace First\Vendor\AsyncAws\S3\Exception;

use First\Vendor\AsyncAws\Core\Exception\Http\ClientException;

/**
 * The specified multipart upload does not exist.
 */
final class NoSuchUploadException extends ClientException
{
}
