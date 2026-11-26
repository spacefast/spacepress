"use client";
// WordPress renders this list in PHP, with the rows already in it. In the browser the Interactivity
// API takes it over: `useLive` keeps the read current, and a tick or a new task runs a mutation.
// Open the site in two windows: a change in one shows in the other, with no reload.
import { useState } from "react";
import { useLive, useMutation } from "spacepress/react";
import { api } from "../_generated/api";

export function TaskList() {
  // The 20 newest, newest first: a live read is a bounded window, and a new task is always in it.
  const tasks = useLive(api.tasks.list({ orderBy: { id: "desc" }, limit: 20 }));
  const add = useMutation(api.actions.addTask);
  const toggle = useMutation(api.actions.setDone);
  const [title, setTitle] = useState("");
  const rows = tasks.data ?? [];
  const left = rows.filter((task) => !task.done).length;
  return (
    <section>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rows.map((task) => (
          <li key={task.id}>
            <label style={{ textDecoration: task.done ? "line-through" : "none" }}>
              <input type="checkbox" checked={task.done} onChange={(event) => toggle.mutate({ id: task.id, done: event.target.checked })} /> {task.title}
            </label>
          </li>
        ))}
      </ul>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        await add.mutate({ title: title.trim() });
        setTitle("");
      }} style={{ display: "flex", gap: ".5rem" }}>
        <input value={title} onInput={(event) => setTitle(event.target.value)} placeholder="Add a task" aria-label="New task" />
        <button type="submit" disabled={add.pending}>Add</button>
      </form>
      <p>{left} of the latest {rows.length} left, saved in WordPress.</p>
    </section>
  );
}
