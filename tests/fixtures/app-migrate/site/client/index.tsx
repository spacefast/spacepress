import type { ComponentChildren } from "preact";

export function Layout({ children }: { children: ComponentChildren }) {
  return (
    <main class="site">
      <nav><a href="/">Home</a> · <a href="/pricing">Pricing</a> · <a href="/docs">Docs</a></nav>
      {children}
    </main>
  );
}
