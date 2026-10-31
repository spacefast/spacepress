/**
 * Adapted from CIAB Admin packages/dataviews/src/index.ts.
 * Copyright the CIAB Admin contributors. GPL-2.0-or-later.
 * Uses the standalone module build to keep this admin independent of wp globals.
 */
import "@wordpress/theme/design-tokens.css";
import "@wordpress/components/build-style/style.css";
import "@wordpress/dataviews/build-style/style.css";
export * from "@wordpress/dataviews";
