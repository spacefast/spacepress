import { db } from "typedpress";
import { Content, Link, type PageProps } from "typedpress/app";
import { CheerButton } from "../../../components/CheerButton";
import styles from "./note.module.css";

// notes' `url` is /notes/:slug, so this page receives the note as `item`, read as the visitor;
// a draft, or a slug no visitor may read, is a 404.
export const metadata = ({ item }: PageProps<"notes/[slug]">) => ({
  title: item.title,
  description: item.dek ?? "",
  canonical: `/notes/${item.slug}`,
});

export default async function NotePage({ item }: PageProps<"notes/[slug]">) {
  const cheers = await db.query.cheers.findFirst({ where: { noteId: item.id } });
  return (
    <article className={styles.note}>
      <p className={styles.back}><Link href="/notes">← All notes</Link></p>
      <h1>{item.title}</h1>
      {item.dek && <p className={styles.dek}>{item.dek}</p>}
      {item.deskNotes && (
        <aside className={styles.desk}>
          <p><strong>Desk notes:</strong> {item.deskNotes}</p>
        </aside>
      )}
      <Content value={item.body} />
      <p className="cheer"><CheerButton noteId={item.id} count={cheers?.count ?? 0} /></p>
    </article>
  );
}
