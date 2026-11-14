import { Link } from "first/app";

export const metadata = { title: "Home" };

export default function Home() {
  return (
    <main className="home">
      <h1>First docs</h1>
      <p>Everything here is content in WordPress, written as Markdown in the repository.</p>
      <Link href="/docs/introduction">Read the docs</Link>
    </main>
  );
}
