import { Link } from "spacepress/server/app";

export const metadata = { title: "Home" };

export default function Home() {
  return (
    <main className="home">
      <h1>SpacePress docs</h1>
      <p>Everything here is content in WordPress, written as Markdown in the repository.</p>
      <Link href="/docs/introduction">Read the docs</Link>
    </main>
  );
}
