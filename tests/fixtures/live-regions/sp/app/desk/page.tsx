import { notes } from "spacepress/server/db";
import { Live } from "spacepress/app";

export default async function DeskPage() {
  return <Live id="count"><p className="count">{await notes.count()}</p></Live>;
}
