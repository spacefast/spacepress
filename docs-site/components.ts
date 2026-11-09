import { defineComponents } from "blume";

// Static components every MDX page can use without an import. Both render at build time and ship
// no JavaScript.
export default defineComponents({
	mdx: {
		CodeFile: "./lib/CodeFile.astro",
		ExampleConfig: "./lib/ExampleConfig.astro",
		RepoFile: "./lib/RepoFile.astro",
	},
});
