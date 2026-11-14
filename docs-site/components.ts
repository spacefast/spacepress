import { defineComponents } from "blume";

// Components every MDX page can use without an import. They render at build time. Only Showcase
// ships a script, which switches the file it shows.
export default defineComponents({
	mdx: {
		CodeFile: "./lib/CodeFile.astro",
		CompiledExcerpt: "./lib/CompiledExcerpt.astro",
		ExampleConfig: "./lib/ExampleConfig.astro",
		RepoFile: "./lib/RepoFile.astro",
		Showcase: "./lib/Showcase.astro",
	},
});
