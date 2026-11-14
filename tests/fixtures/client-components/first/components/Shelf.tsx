"use client";
import { useState } from "first/client";

type Book = { id: number; title: string };

// A list and conditionals over state: the browser re-renders them from <template>s.
export function Shelf({ books: initial }: { books: Book[] }) {
  const [books, setBooks] = useState(initial);
  const [open, setOpen] = useState(true);
  const add = () => setBooks([...books, { id: books.length + 1, title: `Book ${books.length + 1}` }]);
  const drop = () => setBooks(books.slice(1));
  return (
    <section className="shelf">
      <button type="button" className="shelf-add" onClick={add}>more</button>
      <button type="button" className="shelf-drop" onClick={drop}>fewer</button>
      <button type="button" className="shelf-toggle" onClick={() => setOpen(!open)}>toggle</button>
      {open && <p className="shelf-open">open</p>}
      {books.length === 0 ? <em className="shelf-empty">empty</em> : <strong className="shelf-count">{books.length}</strong>}
      <ol>
        {books.map((book) => <li key={book.id} className="shelf-book" data-id={book.id}>{book.title}</li>)}
      </ol>
    </section>
  );
}
