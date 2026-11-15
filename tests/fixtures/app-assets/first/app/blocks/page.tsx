import { Content, Link } from "first/app";

export const metadata = { title: "Blocks" };

// Block content as the editor saves it: a colour from the theme's palette, a row layout and a code block.
const body = `<!-- wp:paragraph {"textColor":"accent"} -->
<p class="has-accent-color has-text-color">In the theme's accent colour.</p>
<!-- /wp:paragraph -->

<!-- wp:group {"layout":{"type":"flex"}} -->
<div class="wp-block-group"><!-- wp:paragraph -->
<p>In a row.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:code -->
<pre class="wp-block-code"><code>let a = 1;</code></pre>
<!-- /wp:code -->`;

export default function Blocks() {
  return (
    <article>
      <Content value={body} />
      <Link href="/about">About</Link>
    </article>
  );
}
