<?php

namespace First\Vendor\AsyncAws\S3\Result;

use First\Vendor\AsyncAws\Core\Response;
use First\Vendor\AsyncAws\Core\Result;
use First\Vendor\AsyncAws\S3\Enum\RequestCharged;

class AbortMultipartUploadOutput extends Result
{
    /**
     * @var RequestCharged::*|null
     */
    private $requestCharged;

    /**
     * @return RequestCharged::*|null
     */
    public function getRequestCharged(): ?string
    {
        $this->initialize();

        return $this->requestCharged;
    }

    protected function populateResult(Response $response): void
    {
        $headers = $response->getHeaders();

        $this->requestCharged = $headers['x-amz-request-charged'][0] ?? null;
    }
}
