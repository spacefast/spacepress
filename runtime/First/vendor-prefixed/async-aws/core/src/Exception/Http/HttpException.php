<?php

declare(strict_types=1);

namespace First\Vendor\AsyncAws\Core\Exception\Http;

use First\Vendor\AsyncAws\Core\Exception\Exception;
use First\Vendor\Symfony\Contracts\HttpClient\ResponseInterface;

interface HttpException extends Exception
{
    public function getResponse(): ResponseInterface;

    public function getAwsCode(): ?string;

    public function getAwsType(): ?string;

    public function getAwsMessage(): ?string;

    public function getAwsDetail(): ?string;
}
