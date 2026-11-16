// What the guide's sections are written with. Code, diffs and file trees are custom elements that
// hold their text; browser/code.ts draws them with @pierre/diffs and @pierre/trees. Without
// JavaScript the text is still on the page, as plain monospace.
import type { ReactNode } from "typedpress/app";
import { sections } from "./guide/sections";
import { sources } from "../data/sources";

const numberOf = (id: string) => sections.findIndex((s) => s.id === id) + 1;
const textOf = (path: string) => {
  const found = sources.find((s) => s.path === path);
  return found ? found.text : `(no file ${path} in examples/)`;
};

/** A section's heading, numbered by its place in tp/guide/sections.ts. */
export function Section({ id }: { id: string }) {
  const section = sections.find((s) => s.id === id);
  return <h2 id={id}><span className="n">{numberOf(id)}</span>{section ? section.title : id}</h2>;
}

/** The number of another section, as a link: "section <Ref to="pages" />". */
export function Ref({ to }: { to: string }) {
  return <a className="ref" href={`#${to}`}>{numberOf(to)}</a>;
}

export function Toc() {
  return (
    <ul className="toc">
      {sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`}><span className="n">{i + 1}</span>{s.title}</a></li>)}
    </ul>
  );
}

export const Built = () => <span className="b built">Works today</span>;
export const Decided = () => <span className="b ruled">Decided</span>;
export const Proposed = () => <span className="b prop">Proposed</span>;

/** Code written in the page. With `file` it gets a header with that path; `lang` is for a snippet with no file. */
export function Code({ file, lang, note, children }: { file?: string; lang?: string; note?: string; children?: ReactNode }) {
  return <tp-code file={file} lang={lang} note={note}>{children}</tp-code>;
}

/** A file from examples/, shown under `as` when the guide calls it by another path. */
export function Source({ path, as, lang, note }: { path: string; as?: string; lang?: string; note?: string }) {
  return <tp-code file={as ?? path} lang={lang} note={note}>{textOf(path)}</tp-code>;
}

/** The difference between two files from examples/. */
export function Diff({ old, new: next, oldName, newName }: { old: string; new: string; oldName?: string; newName?: string }) {
  return (
    <tp-diff>
      <tp-code file={oldName ?? old}>{textOf(old)}</tp-code>
      <tp-code file={newName ?? next}>{textOf(next)}</tp-code>
    </tp-diff>
  );
}

/** A file tree from an indented listing: two spaces per level, folders end with "/", then two spaces and a note. */
export function Tree({ children }: { children?: ReactNode }) {
  return <tp-tree>{children}</tp-tree>;
}

/** A whole project from examples/<name>/: its tree, and each file. `open` is the file shown first. */
export function Example({ name, open }: { name: string; open?: string }) {
  const files = sources.filter((s) => s.path.startsWith(`${name}/`));
  return (
    <tp-example className="wide" open={open}>
      {files.map((f) => <tp-code key={f.path} file={f.path.slice(name.length + 1)} note={f.note ?? undefined} label={f.label ?? undefined}>{f.text}</tp-code>)}
    </tp-example>
  );
}
