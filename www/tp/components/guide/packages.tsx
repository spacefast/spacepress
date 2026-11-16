import { Section, Ref, Code, Built, Decided } from "../Guide";

export function Packages() {
  return (
    <>
      <Section id="packages" />
      <p><Built /> A plugin package is an npm package that adds handlers, functions and jobs to an app. This is different from a WordPress plugin (section <Ref to="rules" />).</p>
      <Code file="node_modules/typedpress-plugin-seo/src/index.ts">{`import { definePlugin } from "typedpress";

export default (options: { suffix: string }) =>
  definePlugin({
    name: "seo",
    hooks: { posts: { beforeCreate(data) { data.summary = summarize(data.title) + options.suffix; } } },
  });

// typedpress.config.ts
import seo from "typedpress-plugin-seo";
export default defineConfig({ use: [seo({ suffix: " | Site" })] });`}</Code>
      <ul>
        <li>The compiler records everything a package's code can do: which kinds it reads and writes, which hosts it calls, which secrets it reads, whether it sends mail.</li>
        <li>That list is written to a lock file you commit. The lock is the grant: a new version that wants more fails the build until you accept it.</li>
        <li><Decided /> A package adds its handlers with <code>kind.on()</code>, as an app does. Today it lists them under <code>hooks</code> in <code>definePlugin</code>.</li>
      </ul>
    </>
  );
}
