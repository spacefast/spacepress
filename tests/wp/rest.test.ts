// WordPress lane of the shared blog scenario (design §9.1): the same function the standalone lane
// runs, driven by the generated typed client over /wp-json/zero/v1 with application passwords.
// Promotion is WordPress's own: `future` post + its cron event, run through WP-CLI.
import { test, before } from "node:test";
import { createClient } from "../../examples/blog/zero/client/index.ts";
import { blogScenario, type ScenarioRole } from "../e2e/blog-scenario.ts";
import assert from "node:assert/strict";
import { api, auth, harness, sql, wp, zero } from "./env.ts";

before(() => {
  // The scenario's author owns an `authors` row (authors are admin-only over the API; the CLI is trusted).
  const userId = harness.users.author.id;
  if (zero("find", "authors", JSON.stringify({ where: { userId } })).length === 0) {
    zero("insert", "authors", JSON.stringify({ name: "Author", email: `author-${userId}@example.test`, userId }));
  }
});

test("blog scenario over /wp-json/zero/v1", async (t) => {
  await blogScenario(
    {
      target: "wp",
      client: (role: ScenarioRole) =>
        createClient({ url: api, headers: role === "anonymous" ? {} : auth(role) }),
      async promoteDue(at: string) {
        // The clock can't move, so pull each due post's date into the past, let WP cron publish it
        // (`publish_future_post` only publishes once post_date_gmt has passed), then put the date back.
        const due = at.slice(0, 19).replace("T", " ");
        const ids = sql(`SELECT ID FROM wp_posts WHERE post_type = 'zero_posts' AND post_status = 'future' AND post_date_gmt <= '${due}'`).map((r) => Number(r.ID));
        const trace = () => sql(`SELECT p.ID AS id, (SELECT COUNT(*) FROM wp_posts r WHERE r.post_parent = p.ID AND r.post_type = 'revision') AS revisions,
          (SELECT meta_value FROM wp_postmeta m WHERE m.post_id = p.ID AND m.meta_key = 'zero_updatedAt') AS updatedAt FROM wp_posts p WHERE p.ID IN (${ids.join(",") || 0}) ORDER BY p.ID`);
        const before = trace();
        for (const id of ids) {
          sql(`UPDATE wp_posts SET post_date_gmt = '2000-01-01 00:00:00', post_date = '2000-01-01 00:00:00' WHERE ID = ${id}`);
          wp("cron", "event", "schedule", "publish_future_post", "now", `--0=${id}`);
        }
        wp("cron", "event", "run", "--due-now");
        // §6.3: promotion writes no revision and no generated values (hooks: the test app's afterCreate/afterUpdate trace on "Audit" posts).
        assert.deepEqual(trace(), before, "WP cron promotion is not an edit");
        for (const id of ids) {
          sql(`UPDATE wp_posts SET post_date_gmt = '${due}', post_date = '${due}' WHERE ID = ${id}`);
        }
        wp("cache", "flush");
      },
    },
    t,
  );
});
