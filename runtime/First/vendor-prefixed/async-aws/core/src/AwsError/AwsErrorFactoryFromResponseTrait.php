<?php

namespace First\Vendor\AsyncAws\Core\AwsError;

use First\Vendor\Symfony\Contracts\HttpClient\ResponseInterface;

trait AwsErrorFactoryFromResponseTrait
{
    public function createFromResponse(ResponseInterface $response): AwsError
    {
        $content = $response->getContent(false);
        $headers = $response->getHeaders(false);

        return $this->createFromContent($content, $headers);
    }
}
