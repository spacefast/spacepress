import logo from "./compass.svg";

export const metadata = { title: "About", description: "What this site is and how it is built." };

export default function About() {
  return (
    <article className="about">
      <figure><img src={logo} alt="A compass" width={64} height={64} /></figure>
      <h1>About</h1>
      <p>
        These pages are written as <code>page.tsx</code> files under <code>first/app/</code>, compiled to PHP, and
        rendered by WordPress on every request. Notes are ordinary WordPress content with First's access rules.
      </p>
      <ul>
        <li>Note pages are the notes themselves, read as the visitor.</li>
        <li>Drafts stay private until they are published.</li>
        <li>The cheer button is a <code>"use client"</code> component on the Interactivity API.</li>
      </ul>
    </article>
  );
}
