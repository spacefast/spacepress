import type { Metadata } from "@spacefast/zero-pages";
import logo from "./compass.svg";

export const metadata = {
  title: "About",
  description: "What this site is and how it is built.",
} satisfies Metadata;

export default function About() {
  return (
    <article className="about">
      <figure><img src={logo} alt="A compass" width={64} height={64} /></figure>
      <h1>About</h1>
      <p>
        These pages are written as <code>page.tsx</code> files, compiled once to Gutenberg block markup, and rendered by
        WordPress on every request. Notes are ordinary WordPress content with Zero's access rules.
      </p>
      <ul>
        <li>Static pages are hidden, code-owned WordPress Pages.</li>
        <li>Note pages are the notes themselves, read as the visitor.</li>
        <li>Drafts stay private until they are published.</li>
      </ul>
    </article>
  );
}
