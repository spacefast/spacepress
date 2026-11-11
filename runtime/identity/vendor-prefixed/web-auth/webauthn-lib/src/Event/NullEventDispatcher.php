<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Event;

use First\Identity\Vendor\Psr\EventDispatcher\EventDispatcherInterface;

final class NullEventDispatcher implements EventDispatcherInterface
{
    public function dispatch(object $event): object
    {
        return $event;
    }
}
