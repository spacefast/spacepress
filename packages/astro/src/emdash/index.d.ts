import type { AstroIntegration } from "astro";

/**
 * Runs an official EmDash Astro template on a First site with no code in the template: `emdash`,
 * `emdash/ui`, `emdash/page` and `emdash/runtime` resolve to `@first/astro/emdash`, which reads the
 * site's API at `FIRST_URL`.
 */
export declare function firstEmdash(): AstroIntegration;
export default firstEmdash;
