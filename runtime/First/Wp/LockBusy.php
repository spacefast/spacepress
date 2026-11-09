<?php

declare(strict_types=1);

namespace First\Wp;

/** Another request holds the named lock after its acquisition timeout expires. */
final class LockBusy extends \RuntimeException
{
}
