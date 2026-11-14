<?php

declare(strict_types=1);

namespace First\Render;

use First\Html;

/**
 * `<Live>` regions (docs/decisions/2026-11-14-live-regions.md). A page renders each region through
 * {@see region()}: in a normal render that is the region's markup inside a marked element; when the
 * subscription endpoint renders one region of the page ({@see capture()}), it also records the
 * route's reads, the region's HTML, and whether anything in it depends on data First can't count
 * ({@see unseen()}), so the endpoint can answer "not modified" by counter only when that is safe.
 */
final class Live
{
    /** @var ?array{id: string, html: ?string, reads: array, unseen: bool, found: bool} the region the endpoint asked for */
    private static ?array $capture = null;

    /** A `<Live>` region: its children rendered now, in an element the router region can update. */
    public static function region(string $id, \Closure $render): Html
    {
        $html = Html::child($render());
        if (self::$capture !== null && self::$capture['id'] === $id) {
            self::$capture['html'] = $html;
            self::$capture['found'] = true;
        }

        return Html::element('div', ['data-first-live' => $id], Html::raw($html));
    }

    /**
     * Marks the page being rendered for a region as depending on something the counters can't see
     * (the clock, WordPress options, core queries): it is rendered and compared on every poll.
     */
    public static function unseen(): void
    {
        // Anywhere in the route, like its reads: a page can read it above the region and pass it in.
        if (self::$capture !== null) {
            self::$capture['unseen'] = true;
        }
    }

    /**
     * Runs $render (one render of a whole page) and returns what region $id rendered within it:
     * its HTML, its own reads, whether it read anything unseen, and whether the page has it at all.
     *
     * @return array{html: ?string, reads: array, unseen: bool, found: bool}
     */
    public static function capture(string $id, \Closure $render): array
    {
        $previous = self::$capture;
        self::$capture = ['id' => $id, 'html' => null, 'reads' => [], 'unseen' => false, 'found' => false];
        try {
            // The whole route's reads, not the region's alone: a page reads data above its `<Live>`
            // and passes it in (`const all = await notes.list(); <Live>{all.map(…)}</Live>`), and
            // those reads happen before the region renders. Counting more kinds than the region
            // shows only makes it re-render more often, never less safely.
            Reads::during($render, $reads);
            self::$capture['reads'] = $reads;

            return array_diff_key(self::$capture, ['id' => true]);
        } finally {
            self::$capture = $previous;
        }
    }
}
