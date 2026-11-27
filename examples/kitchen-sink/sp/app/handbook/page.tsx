import { Link, type PageProps } from "spacepress/app";

export const metadata = { title: "Kitchen handbook" };

export default async function HandbookIndex({ db }: PageProps) {
  const chapters = await db.handbook.nav();
  return <section><h1>Kitchen handbook</h1><ul>{chapters.map((chapter) => <li><Link href={chapter.href}>{chapter.title}</Link></li>)}</ul></section>;
}
