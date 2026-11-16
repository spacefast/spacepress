// Asset imports type as the compiler binds them (types/typedpress/assets.d.ts).
/// <reference path="../assets.d.ts" />
import styles from "./fixtures/card.module.css";
import logo from "./fixtures/logo.svg";
import "./fixtures/site.css";

const title: string = styles.title;
const src: string = logo;
// @ts-expect-error a CSS module's classes are read-only
styles.title = "x";
export { title, src };

// A server action, called from a "use client" component, takes the action's own input.
import { action, integer } from "typedpress";
const cheer = action({ input: { noteId: integer() }, access: "anyone", async handler({ noteId }) { return { count: noteId }; } });
export async function clientCall(): Promise<number> {
  // @ts-expect-error the input is the action's own
  await cheer({ note: 1 });
  return (await cheer({ noteId: 1 })).count;
}
