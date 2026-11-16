import { db } from "first";
import type { LayoutProps } from "first/app";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export default async function Root({ children }: LayoutProps) {
  const count = (await db.query.notes.findMany({})).length;
  return (
    <div>
      <p className="layout-count">layout {count}</p>
      {children}
    </div>
  );
}
