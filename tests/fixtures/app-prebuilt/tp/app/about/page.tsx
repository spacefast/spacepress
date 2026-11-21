export const prerender = true;
export const metadata = { title: "About", scripts: ["/about-module.mjs"] };

export default function About() {
  return <article className="about"><h1>About</h1><p>Written once.</p></article>;
}
