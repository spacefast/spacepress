# Components in Markdown are the app's blocks

Date: 2026-11-13. Status: accepted. Spec: [spec.md](../spec/spec.md) §1 (`content/` synced into
kinds), [rendering.md](../spec/rendering.md) §3 (server components).

## Problem

A documentation page wants more than Markdown: a callout, a badge, a set of steps. The project
already writes these as server components in `first/components/`. A Markdown page needs to use
them, and since content is a kind an editor changes in the block editor, the same component has to
be editable there and survive `first sync` back to the file.

## Decision

**A component a file lists in `export const blocks` is a block.** Nothing else is needed.

```tsx
// first/components/Callout.tsx
export const blocks = ["Callout"];

export function Callout({ type, title, children }: { type: "note" | "warning"; title?: string; children?: JSX.Element }) {
  return <aside className={`callout callout-${type}`}>{title && <p>{title}</p>}{children}</aside>;
}
```

```md
<Callout type="warning" title="Before you start">
Back up the **database**.
</Callout>
```

- **In WordPress** it is a dynamic block, `<app>/callout`, registered with the component's props as
  its attributes. The site renders it by calling the component: its attributes are the props and
  its inner blocks, rendered, are `children`. The block editor inserts it, edits its props in the
  sidebar and its content as inner blocks, and previews a block without children by rendering it
  on the server. A block without children uses core's `autoRegister` block support (WordPress
  7.0+), which registers it in the editor with the server preview and a sidebar field per prop;
  only blocks with children need the runtime's editor script, for their inner blocks.
- **In a Markdown file** it is the tag, alone on its lines. Attribute values are `"text"`,
  `{true}`, `{false}` or `{number}`; what is between the tags is Markdown. Writing the block back
  gives the same tag, so `first sync` round-trips it, and an editor's change to a prop changes the
  tag.
- **Its attributes are typed by the component.** The compiler reads the component's props: text,
  a union of text literals (an `enum`), numbers and booleans, each optional or required. A prop a
  tag can't write (an array, an object, a function) is a build error at the component. A tag that
  names no block, a prop the component doesn't take, a value of the wrong type, a missing required
  prop or an unclosed tag is refused with the reason, and nothing is stored.
- **A tag inside a code fence is code.**

## Alternatives not taken

- **MDX compiled by the Rust compiler.** MDX is JSX with expressions; its source can't be stored in
  WordPress or edited in the block editor, and `first sync` could not write it back from blocks.
- **Markdown directives (`:::callout{type=warning}`).** Directives say the same thing in a syntax no
  editor or agent writes by default, and the mapping to a component would still need the props the
  compiler already has. The tag is the component's own name and JSX's own attribute spelling.
- **A `blocks` key in `defineConfig`.** The component file is where its props are; listing it there
  keeps the declaration next to the code.

## Cost

- Only components whose props are text, numbers and booleans can be blocks. A component that needs
  more takes it from the page instead.
- A tag must open and close on lines of its own; an inline component (inside a sentence) isn't a
  block, as blocks aren't inline in WordPress either.
