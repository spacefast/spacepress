// "zero:db" resolves in hook modules too, read while the module loads.
import { note } from "zero:db";
const column = note.title;
export default function (title: string, postId: number): string {
  return title;
}
