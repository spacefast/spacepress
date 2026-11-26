// run.sh appends this to the frozen blog it copies to tests/wp/app/sp/blog/spacepress.config.ts: the
// WP suites' extra post hooks, declared in the file that declares `posts`, as `.on()` requires.
// Every post titled "Audit…" gets a comment naming the hook and the user that triggered it.
posts.on({
  async afterCreate(row, ctx) {
    if (row.title.startsWith("Audit")) {
      const who = ctx.user ? ctx.user.name : "nobody";
      await db.insert(comments).values({ postId: row.id, name: "afterCreate", body: `by ${who}` });
    }
    if (row.title === "Explode") {
      throw new HttpError(500, "boom", "afterCreate exploded");
    }
  },
  async afterUpdate(row, previous, ctx) {
    if (row.title.startsWith("Audit")) {
      await db.insert(comments).values({ postId: row.id, name: "afterUpdate", body: `${previous.title} -> ${row.title}` });
    }
  },
});
