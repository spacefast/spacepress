// This page reads nothing, so it is prebuilt: WordPress writes it to a file once and
// serves the file. Every other page renders per request.
export const prerender = true;

export const metadata = { title: "About", description: "What this site is and how it is built." };

export default function About() {
  return (
    <article className="about">
      <h1>About</h1>
      <ul>
        <li>Note pages are the notes themselves, read as the visitor.</li>
        <li>Drafts stay private until they are published.</li>
        <li>The cheer button is a "use client" component.</li>
      </ul>
    </article>
  );
}
