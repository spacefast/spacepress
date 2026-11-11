<?php

declare(strict_types=1);

namespace First\Vendor\Rowbot\URL;

enum APIParserErrorType
{
    case NONE;

    case URL;

    case BASE;
}
