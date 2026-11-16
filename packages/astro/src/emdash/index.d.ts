import type { AstroIntegration } from "astro";

/**
 * Runs an official EmDash Astro template on a TypedPress site with no code in the template: `emdash`,
 * `emdash/ui`, `emdash/page` and `emdash/runtime` resolve to `@typedpress/astro/emdash`, which reads the
 * site's API at `TP_URL`.
 */
export declare function tpEmdash(options?: { /** Where the template serves pages: "/pages/" (blog, default) or "/" (starter). */ pagesAt?: string }): AstroIntegration;
export default tpEmdash;
