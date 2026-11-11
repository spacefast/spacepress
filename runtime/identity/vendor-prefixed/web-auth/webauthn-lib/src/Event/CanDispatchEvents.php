<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Event;

use First\Identity\Vendor\Psr\EventDispatcher\EventDispatcherInterface;

interface CanDispatchEvents
{
    public function setEventDispatcher(EventDispatcherInterface $eventDispatcher): void;
}
