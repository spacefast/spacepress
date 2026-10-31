<?php

declare(strict_types=1);

namespace Zero\Auth;

/** A failed password attempt: its throttle count commits with the 401 (see Reused). */
final class Failed extends Reused
{
}
