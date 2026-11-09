// Cases where an earlier renderer disagreed with React 19.2.8.
import type { ReactNode } from "react";

function Sole({ children }: { children?: ReactNode }) {
  return children ? <b>yes</b> : <i>no</i>;
}

function Text({ children }: { children: string }) {
  return <q>{children.toUpperCase()}</q>;
}

// One child is passed as itself, so a falsy child is falsy; several are an array.
export function Children({ s, n, flag }: { s: string; n: number; flag: boolean }) {
  return (
    <div>
      <Sole>{null}</Sole>
      <Sole>{n}</Sole>
      <Sole>{s}</Sole>
      <Sole>{flag && <b />}</Sole>
      <Sole>
        <b />
      </Sole>
      <Sole>
        a{s}
      </Sole>
      <Text>{s}</Text>
    </div>
  );
}

// `value` wins over `defaultValue` only when it isn't undefined; the same for `checked`.
export function Inputs({ v, c }: { v?: string; c?: boolean }) {
  return (
    <form>
      <input value={v} defaultValue="fallback" />
      <input type="checkbox" checked={c} defaultChecked={true} />
      <textarea value={v} defaultValue="area" />
    </form>
  );
}

// `<pre>` doubles a leading newline only when its one child is a string.
export function Pre({ s }: { s: string }) {
  return (
    <div>
      <pre>{s}</pre>
      <pre>{s}{"x"}</pre>
      <pre>{"\nlit"}</pre>
    </div>
  );
}

// React drops an empty `href` except on <a>, and an empty `src`; it keeps an empty `xlinkHref`.
export function EmptyUrls({ e }: { e: string }) {
  return (
    <div>
      <a href={e}>a</a>
      <area href={e} />
      <img src={e} alt="" loading="lazy" />
      <svg>
        <use xlinkHref={e} />
      </svg>
      <my-el style={e ? { color: e } : undefined} />
    </div>
  );
}

// A lone surrogate in a numeric entity decodes to U+FFFD, as Babel and esbuild decode it.
export function Entities() {
  return <p>&#xD800;|&#55296;|&#x1F600;|&#0;</p>;
}

// A lowercase export is a helper, not a component, and any signature works.
export function fmt(a: string, b: string): string {
  return `${a}/${b}`;
}

function Item({ text }: { text: string }) {
  return <li>{text}</li>;
}

// `key` evaluates in source order, as in React, and never reaches props or HTML.
export function Keys({ ids }: { ids: number[] }) {
  const order: string[] = [];
  const note = (label: string): string => {
    order.push(label);
    return label;
  };
  const items = ids.map((id) => <Item key={note(`k${id}`)} text={note(fmt("t", String(id)))} />);
  const rows = ids.map((id) => <li key={note(`e${id}`)}>{id}</li>);
  return (
    <ul data-order={order.join(",")}>
      {items}
      {rows}
    </ul>
  );
}
