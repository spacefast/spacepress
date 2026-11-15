import { Html } from "first/app";
import "./play.css";

export const metadata = {
  title: "TypedPress playground",
  description: "Edit a TypedPress app and compile it in your browser. See the PHP, SQL and types the compiler writes, then run the app in WordPress, also in your browser.",
  scripts: ["/play.js"],
};

export default function Playground() {
  return (
    <div className="tp-play">
      <Html value={`
<p class="crumb"><a href="/">← Building a TypedPress app</a></p>
<h1>Playground</h1>
<p class="lede">Edit an app and it is compiled in your browser by the same compiler the command line uses. Then run your version in WordPress, also in your browser. Nothing is sent to a server.</p>
<div class="note">These are the example apps as they are in the code today, so they use the current names: <code>first.config.ts</code>, <code>first/</code>, <code>action()</code>. The guide describes the names they are moving to.</div>

<main id="play" data-wasm="/compiler.wasm" data-examples="/play-data.json" data-site="https://typedpress-guide.space.fast">
  <div class="top">
    <label for="example">Example</label>
    <select id="example"></select>
    <button id="reset" type="button">Reset</button>
    <span class="spacer"></span>
    <button id="run" class="go" type="button">Run in WordPress</button>
  </div>
  <p id="summary" class="cap"></p>
  <p id="status" role="status" aria-live="polite" data-state="loading">Loading…</p>
  <ul id="problems"></ul>
  <section id="wordpress" hidden>
    <p><span id="wordpress-note"></span> <a id="tab" target="_blank" rel="noopener">Open in a new tab</a></p>
    <iframe id="frame" title="WordPress running your version of the example"></iframe>
  </section>
  <div class="panes">
    <section class="pane">
      <h2>You write <small>click in the file and type</small><button id="source-diff" type="button" aria-pressed="false">Show my changes</button></h2>
      <div class="split"><div class="treebox" id="source-tree"></div><div class="filebox" id="source"></div></div>
    </section>
    <section class="pane out">
      <h2>The compiler writes <small>updates as you type</small><button id="output-diff" type="button" aria-pressed="false">Show what my edit changed</button></h2>
      <div class="split"><div class="treebox" id="output-tree"></div><div class="filebox" id="output"></div></div>
    </section>
  </div>
</main>
<footer>The compiler is the TypedPress compiler built for the browser (WebAssembly, 7 MB). WordPress runs through <a href="https://wordpress.org/playground/">WordPress Playground</a>. Files, trees and diffs are rendered with <a href="https://diffs.com">@pierre/diffs</a> and @pierre/trees (<a href="third-party-licenses.txt">licences</a>).</footer>

`} />
    </div>
  );
}
