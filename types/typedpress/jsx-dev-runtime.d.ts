// JSX types for TypedPress's TSX (`"jsxImportSource": "typedpress"` in tsconfig): components compile to PHP
// that renders React's HTML (docs/decisions/2026-11-08-tsx-to-php.md). Types only.
export namespace JSX {
  /** Rendered HTML: what a component returns. */
  interface Element {
    readonly __tpHtml: true;
  }
  interface ElementChildrenAttribute {
    children: {};
  }
  type Child = Element | string | number | bigint | boolean | null | undefined;
  type Children = Child | Children[];
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface IntrinsicElements {
    [tag: string]: {
      children?: Children;
      className?: string;
      style?: Record<string, string | number | undefined>;
      [attribute: string]: unknown;
    };
  }
}
export declare function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
export declare const jsxs: typeof jsx;
export declare const Fragment: unique symbol;
