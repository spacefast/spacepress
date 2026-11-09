<?php

declare(strict_types=1);

namespace Zero\Vendor\Rowbot\URL\Tests;

use Zero\Vendor\Psr\Log\LoggerInterface;
use Zero\Vendor\Psr\Log\LoggerTrait;
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
