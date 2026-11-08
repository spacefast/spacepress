import { capsule, mutation, number, query, string, table } from "@spacefast/zero/server";
import { flags, hash, truncate } from "../shared/bitwise";
import { describe, present } from "../shared/in";
import { forget, publicProfile } from "../shared/delete";
import { firstMatch, uniqueSlug } from "../shared/control-flow";
import { range, split } from "../shared/destructuring";

// Each language construct the v2 compiler learned for live 0.8 apps (zero#138), used from a
// handler. tests/app_migrate.rs converts this capsule and builds the candidate.
export default capsule({
  name: "legacy-language",
  schema: {
    notes: table({ title: string(), score: number() }),
  },
  queries: {
    bitwise: query(async (ctx, title: string, score: number) => [hash(title), flags(true, score > 0), truncate(score)]),
    inOperator: query(async (ctx, title: string) =>
      [describe({ kind: "text", body: title }), present({ [title]: "yes" }, title)]),
    deleteOperator: query(async (ctx, name: string) =>
      [publicProfile({ name, password: "x", token: "y" }), forget({ [name]: 1 }, name)]),
    controlFlow: query(async (ctx, title: string) =>
      [uniqueSlug(title, [title, `${title}-2`]), firstMatch([["a"], ["b", title]], title)]),
    destructuring: query(async (ctx, title: string, score: number) =>
      [range([score, 1, 2]), split({ title })]),
  },
  mutations: {
    add: mutation(async (ctx, title: string, score: number) =>
      ctx.db.notes.insert({ title, score: truncate(score) | hash(title) & 0 })),
  },
});
