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

namespace First\Vendor\League\CommonMark\Extension\TableOfContents;

use First\Vendor\League\CommonMark\Extension\TableOfContents\Node\TableOfContentsPlaceholder;
use First\Vendor\League\CommonMark\Parser\Block\AbstractBlockContinueParser;
use First\Vendor\League\CommonMark\Parser\Block\BlockContinue;
use First\Vendor\League\CommonMark\Parser\Block\BlockContinueParserInterface;
use First\Vendor\League\CommonMark\Parser\Block\BlockStart;
use First\Vendor\League\CommonMark\Parser\Block\BlockStartParserInterface;
use First\Vendor\League\CommonMark\Parser\Cursor;
use First\Vendor\League\CommonMark\Parser\MarkdownParserStateInterface;
use First\Vendor\League\Config\ConfigurationAwareInterface;
use First\Vendor\League\Config\ConfigurationInterface;

final class TableOfContentsPlaceholderParser extends AbstractBlockContinueParser
{
    /** @psalm-readonly
     * @var \First\Vendor\League\CommonMark\Extension\TableOfContents\Node\TableOfContentsPlaceholder */
    private $block;

    public function __construct()
    {
        $this->block = new TableOfContentsPlaceholder();
    }

    public function getBlock(): \First\Vendor\League\CommonMark\Node\Block\AbstractBlock
    {
        return $this->block;
    }

    public function tryContinue(Cursor $cursor, BlockContinueParserInterface $activeBlockParser): ?BlockContinue
    {
        return BlockContinue::none();
    }

    public static function blockStartParser(): BlockStartParserInterface
    {
        return new class () implements BlockStartParserInterface, ConfigurationAwareInterface {
            /** @psalm-readonly-allow-private-mutation
             * @var \First\Vendor\League\Config\ConfigurationInterface */
            private $config;

            public function tryStart(Cursor $cursor, MarkdownParserStateInterface $parserState): ?BlockStart
            {
                $placeholder = $this->config->get('table_of_contents/placeholder');
                if ($placeholder === null) {
                    return BlockStart::none();
                }

                // The placeholder must be the only thing on the line
                if ($cursor->match('/^' . \preg_quote($placeholder, '/') . '$/') === null) {
                    return BlockStart::none();
                }

                return BlockStart::of(new TableOfContentsPlaceholderParser())->at($cursor);
            }

            public function setConfiguration(ConfigurationInterface $configuration): void
            {
                $this->config = $configuration;
            }
        };
    }
}
