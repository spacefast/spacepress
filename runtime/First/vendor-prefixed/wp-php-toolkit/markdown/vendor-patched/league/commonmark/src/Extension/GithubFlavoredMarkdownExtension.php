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

namespace First\Vendor\League\CommonMark\Extension;

use First\Vendor\League\CommonMark\Environment\EnvironmentBuilderInterface;
use First\Vendor\League\CommonMark\Extension\Autolink\AutolinkExtension;
use First\Vendor\League\CommonMark\Extension\DisallowedRawHtml\DisallowedRawHtmlExtension;
use First\Vendor\League\CommonMark\Extension\Strikethrough\StrikethroughExtension;
use First\Vendor\League\CommonMark\Extension\Table\TableExtension;
use First\Vendor\League\CommonMark\Extension\TaskList\TaskListExtension;

final class GithubFlavoredMarkdownExtension implements ExtensionInterface
{
    public function register(EnvironmentBuilderInterface $environment): void
    {
        $environment->addExtension(new AutolinkExtension());
        $environment->addExtension(new DisallowedRawHtmlExtension());
        $environment->addExtension(new StrikethroughExtension());
        $environment->addExtension(new TableExtension());
        $environment->addExtension(new TaskListExtension());
    }
}
