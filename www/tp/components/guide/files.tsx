import { Section, Code, Built } from "../Guide";

export function Files() {
  return (
    <>
      <Section id="files" />
      <p><Built /> A kind with <code>sync</code> keeps its items as Markdown files in <code>tp/content/</code> as well as on the site. <code>typedpress sync</code> moves changes both ways, with a three-way merge and a conflict file when both sides changed the same thing.</p>
      <Code lang="sh">{`typedpress sync                  # files to the site, and the site's edits back to files
typedpress sync --check          # report differences, change nothing
typedpress sync --pr             # open a pull request with the site's edits`}</Code>
      <Code file="tp/content/posts/hello.md">{`---
uid: zr_37d65a42b8767e790ced
title: "Hello"
slug: hello
status: published
tags: [news]
---

Front matter holds the item's fields. The body is its content. The uid ties the file to its record.

<Callout type="warning" title="Before you start">
Back up the **database**.
</Callout>`}</Code>
      <p className="cap">So a writer can work in the WordPress editor and a developer in git, on the same content. <code>typedpress init --github</code> adds a workflow that does this through pull requests.</p>
    </>
  );
}
