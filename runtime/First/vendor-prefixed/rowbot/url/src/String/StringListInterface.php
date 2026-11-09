<?php

declare(strict_types=1);

namespace First\Vendor\Rowbot\URL\String;

use Countable;
use IteratorAggregate;

/**
 * @extends \IteratorAggregate<int, \First\Vendor\Rowbot\URL\String\USVStringInterface>
 */
interface StringListInterface extends Countable, IteratorAggregate
{
    /**
     * @return \First\Vendor\Rowbot\URL\String\USVStringInterface
     */
    public function first();

    public function isEmpty(): bool;

    /**
     * @return \First\Vendor\Rowbot\URL\String\USVStringInterface
     */
    public function last();

    /**
     * @return \First\Vendor\Rowbot\URL\String\USVStringInterface|null
     */
    public function pop();

    /**
     * @param \First\Vendor\Rowbot\URL\String\USVStringInterface $item
     */
    public function push($item): void;
}
