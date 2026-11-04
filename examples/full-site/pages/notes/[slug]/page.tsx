import {
  Island, RichText, Show, collectionPage, link, orElse,
  type CollectionPageContext, type CollectionPageProps, type Metadata,
} from "@spacefast/zero-pages";
import styles from "./note.module.css";

export const route = { id: "notes.show" };
export const page = collectionPage("notes");

export function load({ content, item }: CollectionPageContext<"notes">) {
  // A table read through the visitor's own access rules, keyed by this note.
  const cheers = content.query.cheers.findFirst({ where: { noteId: item.id } });
  return { cheers };
}

type Props = CollectionPageProps<typeof page, ReturnType<typeof load>>;

export function generateMetadata({ item, href }: Props): Metadata {
  return { title: item.title, description: orElse(item.dek, ""), canonical: href };
}

export default function NotePage({ item, cheers }: Props) {
  return (
    <article className={styles.note}>
      <p className={styles.back}><a href={link("/notes")}>← All notes</a></p>
      <h1>{item.title}</h1>
      <Show when={item.dek}>
        <p className={styles.dek}>{item.dek}</p>
      </Show>
      <Show when={item.deskNotes}>
        <aside className={styles.desk}>
          <p><strong>Desk notes:</strong> {item.deskNotes}</p>
        </aside>
      </Show>
      <RichText value={item.body} />
      <Island namespace="fullsite/cheer" module="../../../islands/cheer.client.ts" actions={["cheer"]}
        context={{ noteId: item.id, count: orElse(cheers.count, 0) }}>
        <p className="cheer">
          <button type="button" data-wp-on--click="actions.cheer" data-wp-bind--disabled="context.busy">Cheer</button>{" "}
          <span data-wp-text="context.count">{orElse(cheers.count, 0)}</span> cheers
        </p>
      </Island>
    </article>
  );
}
