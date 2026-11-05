# Compile pages once and fill placeholders per request in a separate plugin

Optional TSX pages must render viewer-bound WordPress data with PHP while
reusing Zero Blocks' serializer and leaving Zero core independent of Blocks.

We chose symbolic values at build time. A page runs once; request data is a
proxy whose reads become placeholders, loops, conditions and viewer-bound
queries in a manifest. The serialized markup goes through WordPress's own
block renderer; placeholders are filled after rendering through the HTML API,
which escapes text and attributes for their context. Region blocks evaluate
loops and conditions per request. A separate `zero-pages-<app>` plugin carries
this runtime and uses only Zero's public read and write seams.

The design's Rust-compiled TSX regions, block-binding sources and compiled
loaders would reuse Zero's JavaScript-to-PHP semantics for arbitrary
expressions. That needs compiler and core changes this optional package must
not own. The cost is a deliberately small subset with explicit helpers for
conditions, fallbacks, row counts, rich text and links; [Pages](../pages.md)
lists the supported operations. Other expressions are refused with their
source location. Widening it later means moving regions onto the compiler,
not loosening the proxy.
