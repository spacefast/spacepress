<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\MetadataService;

use First\Identity\Vendor\Psr\Log\LoggerInterface;

interface CanLogData
{
    public function setLogger(LoggerInterface $logger): void;
}
