"use client";
// Generator B parity: the first render of client components, compared with React once the
// compiler's own `data-wp-*` attributes and text spans are set aside.
import { useState } from "typedpress/client";

export function Counter({ start, label }: { start: number; label: string }) {
  const [count, setCount] = useState(start);
  const [busy, setBusy] = useState(false);
  const text = count === 1 ? "1 click" : `${count} clicks`;
  return (
    <div className={busy ? "busy" : "idle"}>
      <p>{label}: {text}</p>
      <button disabled={busy} onClick={() => setCount(count + 1)}>+1</button>
      <button onClick={() => setBusy(!busy)}>toggle</button>
      <span>{count}</span>
    </div>
  );
}

export function Styled({ color, on }: { color: string; on: boolean }) {
  const [size, setSize] = useState(12);
  return (
    <section className={{ active: on }.active ? "active" : ""} style={{ color, fontSize: size }} title={`${size}px`} aria-pressed={on}>
      <b>{size * 2}</b> {color}
      <input value={color} readOnly onInput={() => setSize(size + 1)} />
    </section>
  );
}

type Book = { id: number; title: string };

// A reactive list and conditionals: the server renders the items and the shown branch, then the
// `<template>`s the browser re-renders from, which parity sets aside.
export function Shelf({ books: initial, open: shown }: { books: Book[]; open: boolean }) {
  const [books, setBooks] = useState(initial);
  const [open, setOpen] = useState(shown);
  return (
    <section>
      <button onClick={() => setBooks(books.slice(1))}>fewer</button>
      <button onClick={() => setOpen(!open)}>toggle</button>
      {open && <p>open</p>}
      {books.length === 0 ? <em>empty</em> : <strong>{books.length} books</strong>}
      <ol>
        {books.map((book) => <li key={book.id} data-id={book.id}>{book.title}<input type="checkbox" checked={open} readOnly /></li>)}
      </ol>
      <ul>{books.map((book) => <li key={book.id}><b>{book.title}</b></li>)}</ul>
    </section>
  );
}
