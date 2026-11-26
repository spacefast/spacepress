"use client";
// WordPress renders this list in PHP, with the rows already in it. In the browser the Interactivity
// API takes it over: `useLive` keeps the read current, and a tick or a new task calls an action.
// Open the site in two windows: a change in one shows in the other, with no reload.
import { useState } from "react";
import { useLive } from "@spacepress/client/react";
import type { InferSelectModel } from "spacepress";
import { addTask, setDone, type tasks as table } from "../schema";

type Task = InferSelectModel<typeof table>;

export function TaskList() {
  // The 20 newest, newest first: a live read is a bounded window, and a new task is always in it.
  const tasks = useLive<Task>("tasks", { orderBy: { id: "desc" }, limit: 20 });
  const [title, setTitle] = useState("");
  const rows = tasks.data ?? [];
  const left = rows.filter((task) => !task.done).length;
  return (
    <section>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rows.map((task) => (
          <li key={task.id}>
            <label style={{ textDecoration: task.done ? "line-through" : "none" }}>
              <input type="checkbox" checked={task.done} onChange={(event) => setDone({ id: task.id, done: event.target.checked })} /> {task.title}
            </label>
          </li>
        ))}
      </ul>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        await addTask({ title: title.trim() });
        setTitle("");
      }} style={{ display: "flex", gap: ".5rem" }}>
        <input value={title} onInput={(event) => setTitle(event.target.value)} placeholder="Add a task" aria-label="New task" />
        <button type="submit">Add</button>
      </form>
      <p>{left} of the latest {rows.length} left, saved in WordPress.</p>
    </section>
  );
}
