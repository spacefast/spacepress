// The home page: the guide, as one page. Each section is a file in first/components/guide/, in the order of
// first/components/guide/sections.ts; add a section by adding it to both.
import { Toc, Built, Decided, Proposed } from "../components/Guide";
import { LatestPosts } from "../components/LatestPosts";
import { Setup } from "../components/guide/setup";
import { Layout } from "../components/guide/layout";
import { How } from "../components/guide/how";
import { Examples } from "../components/guide/examples";
import { Data } from "../components/guide/data";
import { Rw } from "../components/guide/rw";
import { Events } from "../components/guide/events";
import { Server } from "../components/guide/server";
import { Pages } from "../components/guide/pages";
import { Client } from "../components/guide/client";
import { Output } from "../components/guide/output";
import { Box } from "../components/guide/box";
import { Visitor } from "../components/guide/visitor";
import { Editing } from "../components/guide/editing";
import { Frontend } from "../components/guide/frontend";
import { Files } from "../components/guide/files";
import { Agents } from "../components/guide/agents";
import { AppAgents } from "../components/guide/app-agents";
import { Wordpress } from "../components/guide/wordpress";
import { Packages } from "../components/guide/packages";
import { Migrate } from "../components/guide/migrate";
import { Rules } from "../components/guide/rules";
import { Host } from "../components/guide/host";
import { Run } from "../components/guide/run";
import { Cli } from "../components/guide/cli";
import { Config } from "../components/guide/config";
import { Compare } from "../components/guide/compare";
import { Rename } from "../components/guide/rename";
import { Limits } from "../components/guide/limits";
import { Open } from "../components/guide/open";

export const metadata = {
  title: "Building a TypedPress app",
  // The script that draws code, diffs and file trees, and the playground component (browser/site.ts).
  scripts: ["/site.js"],
  description: "Every feature of TypedPress and how to use it, with examples you can edit, build and run in your browser.",
};

export default function Home() {
  return (
    <main className="guide">
      <section className="hero">
      <h1>TypeScript in. A WordPress plugin out.</h1>
      <p className="lede">You describe your data and your pages in TypeScript. TypedPress compiles them into a WordPress plugin. WordPress then gives you the database, the editor, sign-in, the API and an admin, and no JavaScript runs on the server.</p>
      <p className="cap">This is a whole app. Change it and it is built again here, in your browser, by the real compiler. The right side shows every file the build writes and what your change did to them. <b>Run in WordPress</b> starts a WordPress in this tab with your version installed.</p>
      <tp-play example="tasks" open="" />
      </section>
      <div className="note"><b>Read this first.</b> TypedPress is the new name of the framework called First. It is experimental and has no npm release yet. The guide below uses the new names; in the code today, <code>typedpress</code> is spelled <code>first</code> and the <code>tp/</code> folder is <code>first/</code>. Everything you can edit and build on this page runs the compiler as it is today, so it uses today's names. Some spellings may still change.</div>
      <h2 className="plain">The guide</h2>
      <div className="legend">
        <span><Built /> in the code, under the First names</span>
        <span><Decided /> the design is settled, not built yet</span>
        <span><Proposed /> still under discussion</span>
      </div>
      <Toc />
      <Setup />
      <Layout />
      <How />
      <Examples />
      <Data />
      <Rw />
      <Events />
      <Server />
      <Pages />
      <Client />
      <Output />
      <Box />
      <Visitor />
      <Editing />
      <Frontend />
      <Files />
      <Agents />
      <AppAgents />
      <Wordpress />
      <Packages />
      <Migrate />
      <Rules />
      <Host />
      <Run />
      <Cli />
      <Config />
      <Compare />
      <Rename />
      <Limits />
      <Open />
      {/* WordPress content inside a TSX page: the newest posts, read when the page is rendered. */}
      <LatestPosts limit={3} />
    </main>
  );
}
