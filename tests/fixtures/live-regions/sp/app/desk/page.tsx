import { db } from "spacepress/server";
import { Live } from "spacepress/app";

export default async function DeskPage() {
  return <Live id="count"><p className="count">{await db.notes.count()}</p></Live>;
}
