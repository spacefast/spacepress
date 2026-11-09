<?php

namespace First\Vendor\AsyncAws\S3\Exception;

use First\Vendor\AsyncAws\Core\Exception\Http\ClientException;

/**
 * The requested bucket name is not available. The bucket namespace is shared by all users of the system. Select a
 * different name and try again.
 */
final class BucketAlreadyExistsException extends ClientException
{
}
