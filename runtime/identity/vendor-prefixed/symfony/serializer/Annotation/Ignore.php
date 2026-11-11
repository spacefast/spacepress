<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace First\Identity\Vendor\Symfony\Component\Serializer\Annotation;

class_exists(\First\Identity\Vendor\Symfony\Component\Serializer\Attribute\Ignore::class);

if (false) {
    /**
     * @deprecated since Symfony 7.4, use {@see \First\Identity\Vendor\Symfony\Component\Serializer\Attribute\Ignore} instead
     */
    #[\Attribute(\Attribute::TARGET_METHOD | \Attribute::TARGET_PROPERTY)]
    class Ignore extends \First\Identity\Vendor\Symfony\Component\Serializer\Attribute\Ignore
    {
    }
}
