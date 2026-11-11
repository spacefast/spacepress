<?php

declare(strict_types=1);

namespace First\Vendor\Rowbot\URL\Tests;

use First\Vendor\Psr\Log\LoggerInterface;
use First\Vendor\Psr\Log\LoggerTrait;
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
