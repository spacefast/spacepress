<?php

declare(strict_types=1);

namespace TypedPress\Vendor\Rowbot\URL\Tests;

use TypedPress\Vendor\Psr\Log\LoggerInterface;
use TypedPress\Vendor\Psr\Log\LoggerTrait;
use Stringable;

final class ValidationErrorLogger implements LoggerInterface
{
    use LoggerTrait;

    private array $messages;

    public function log($level, string|Stringable $message, array $context = []): void
    {
        $this->messages[] = [$level, $message, $context];
    }
}
