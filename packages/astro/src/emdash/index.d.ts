import type { AstroIntegration } from "astro";

/**
 * Runs an official EmDash Astro template on a SpacePress site with no code in the template: `emdash`,
 * `emdash/ui`, `emdash/page` and `emdash/runtime` resolve to `@spacepress/astro/emdash`, which reads the
 * site's API at `SP_URL`.
 */
export declare function spEmdash(options?: { /** Where the template serves pages: "/pages/" (blog, default) or "/" (starter). */ pagesAt?: string }): AstroIntegration;
export default spEmdash;
