import { db } from "typedpress";
import type { LayoutProps } from "typedpress/app";

export default async function Root({ children }: LayoutProps) {
  const count = (await db.query.notes.findMany({})).length;
  return (
    <div>
      <p className="layout-count">layout {count}</p>
      {children}
    </div>
  );
}
