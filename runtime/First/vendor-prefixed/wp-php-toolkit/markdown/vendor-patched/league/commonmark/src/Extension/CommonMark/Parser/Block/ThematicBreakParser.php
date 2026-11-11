<?php

declare(strict_types=1);

/*
 * This file is part of the league/commonmark package.
 *
 * (c) Colin O'Dell <colinodell@gmail.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace First\Vendor\League\CommonMark\Extension\CommonMark\Parser\Block;

use First\Vendor\League\CommonMark\Extension\CommonMark\Node\Block\ThematicBreak;
use First\Vendor\League\CommonMark\Parser\Block\AbstractBlockContinueParser;
use First\Vendor\League\CommonMark\Parser\Block\BlockContinue;
use First\Vendor\League\CommonMark\Parser\Block\BlockContinueParserInterface;
use First\Vendor\League\CommonMark\Parser\Cursor;

final class ThematicBreakParser extends AbstractBlockContinueParser
{
    /** @psalm-readonly
     * @var \First\Vendor\League\CommonMark\Extension\CommonMark\Node\Block\ThematicBreak */
    private $block;

    public function __construct()
    {
        $this->block = new ThematicBreak();
    }

    public function getBlock(): \First\Vendor\League\CommonMark\Node\Block\AbstractBlock
    {
        return $this->block;
    }

    public function tryContinue(Cursor $cursor, BlockContinueParserInterface $activeBlockParser): ?BlockContinue
    {
        // a horizontal rule can never container > 1 line, so fail to match
        return BlockContinue::none();
    }
}
