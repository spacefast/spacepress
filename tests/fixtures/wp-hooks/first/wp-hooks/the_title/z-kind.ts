import { badges } from "first:db";

// A hook module imports a kind from "first:db" by its registered name and reads it while the module
// loads: hook modules load after every kind has registered. (Kinds exist only while the config is
// built, and handlers run synchronously, so the handler itself doesn't touch it.)
if (!badges.label) throw new Error("the kind's column is missing");

export default function (title: string, postId: number): string {
  return title;
}
