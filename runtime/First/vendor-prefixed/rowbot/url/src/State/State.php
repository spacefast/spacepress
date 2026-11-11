<?php

declare(strict_types=1);

namespace First\Vendor\Rowbot\URL\State;

use First\Vendor\Rowbot\URL\ParserContext;

interface State
{
    public function handle(ParserContext $context, string $codePoint): StatusCode;
}
