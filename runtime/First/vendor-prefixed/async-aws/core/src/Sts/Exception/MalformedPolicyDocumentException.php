<?php

namespace First\Vendor\AsyncAws\Core\Sts\Exception;

use First\Vendor\AsyncAws\Core\Exception\Http\ClientException;

/**
 * The request was rejected because the policy document was malformed. The error message describes the specific error.
 */
final class MalformedPolicyDocumentException extends ClientException
{
}
