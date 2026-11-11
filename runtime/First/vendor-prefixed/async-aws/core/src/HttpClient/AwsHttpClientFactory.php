<?php

namespace First\Vendor\AsyncAws\Core\HttpClient;

use First\Vendor\Psr\Log\LoggerInterface;
use First\Vendor\Symfony\Component\HttpClient\HttpClient;
use First\Vendor\Symfony\Component\HttpClient\RetryableHttpClient;
use First\Vendor\Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * @author Jérémy Derussé <jeremy@derusse.com>
 */
class AwsHttpClientFactory
{
    public static function createRetryableClient(?HttpClientInterface $httpClient = null, ?LoggerInterface $logger = null): HttpClientInterface
    {
        if (null === $httpClient) {
            $httpClient = HttpClient::create();
        }
        if (class_exists(RetryableHttpClient::class)) {
            /** @psalm-suppress MissingDependency */
            $httpClient = new RetryableHttpClient(
                $httpClient,
                new AwsRetryStrategy(),
                3,
                $logger
            );
        }

        return $httpClient;
    }
}
