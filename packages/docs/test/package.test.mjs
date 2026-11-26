import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchEntries } from "../src/entries.ts";
import { ICON_NAMES } from "../src/icons.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("searchEntries lists every page under its top-level section", () => {
  const tree = [
    { title: "Introduction", href: "/docs/introduction", children: [] },
    {
      title: "Guides",
      href: "/docs/guides",
      children: [
        { title: "Writing", href: "/docs/guides/writing", children: [{ title: "Tables", href: "/docs/guides/writing/tables", children: [] }] },
      ],
    },
  ];
  assert.deepEqual(searchEntries(tree, { "/docs/guides/writing": "How pages are written" }), [
    { title: "Introduction", href: "/docs/introduction", section: "Introduction", description: "" },
    { title: "Guides", href: "/docs/guides", section: "Guides", description: "" },
    { title: "Writing", href: "/docs/guides/writing", section: "Guides", description: "How pages are written" },
    { title: "Tables", href: "/docs/guides/writing/tables", section: "Guides", description: "" },
  ]);
});

test("every bundled icon name has a shape in icons.css, and nothing else does", () => {
  const css = new Set([...read("../src/icons.css").matchAll(/\.sd-i-([a-z0-9-]+)\{/g)].map((m) => m[1]));
  assert.deepEqual([...css].sort(), [...ICON_NAMES].sort());
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
});

test("the blocks list names exactly the components blocks.ts exports", () => {
  const source = read("../src/blocks.ts");
  const exported = [...source.matchAll(/export \{([^}]*)\} from/g)]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.trim())
    .filter(Boolean);
  const listed = JSON.parse(source.match(/export const blocks = (\[[^\]]*\])/)[1].replace(/,\s*\]/, "]"));
  assert.deepEqual([...listed].sort(), [...exported].sort());
});
