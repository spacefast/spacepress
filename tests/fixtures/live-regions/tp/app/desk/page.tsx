import { notes } from "typedpress:db";
import { Live } from "typedpress/app";

export default async function DeskPage() {
  return <Live id="count"><p className="count">{await notes.count()}</p></Live>;
}
