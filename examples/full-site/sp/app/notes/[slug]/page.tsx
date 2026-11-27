import { Content, Link, notFound } from "spacepress/app";
import type { PageProps } from "./$types";
import { CheerButton } from "../../../components/CheerButton";
import styles from "./note.module.css";

export const metadata = async ({ params, db }: PageProps) => {
  const item = await db.notes.get({ slug: params.slug });
  return {
    title: item ? item.title : "Note not found",
    description: item?.dek ?? "",
    canonical: item ? `/notes/${item.slug}` : undefined,
  };
};

export default async function NotePage({ params, db }: PageProps) {
  const item = await db.notes.get({ slug: params.slug });
  if (!item) notFound();
  const cheers = await db.cheers.get({ noteId: item.id });
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
