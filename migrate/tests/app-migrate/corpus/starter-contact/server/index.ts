import { capsule, mutation, query, string, table } from "@spacefast/zero/server";

import { cleanSubmission, type SubmissionInput } from "../shared/contact";

export default capsule({
  name: "Contact",
  schema: {
    submissions: table({
      name: string(),
      email: string(),
      message: string(),
    }).index("by_email", ["email"]),
  },
  queries: {
    submissions: query(async (ctx) => {
      // The real gate: guests get an empty inbox no matter what the client renders.
      if (ctx.auth.isGuest) return [];
      return ctx.db.submissions.withIndex("by_creation").order("desc").take(100);
    }),
  },
  mutations: {
    submit: mutation(async (ctx, input: SubmissionInput) => {
      const clean = cleanSubmission(input);
      if (!clean) return { ok: false };
      // Drop an exact resubmission (double-click, retry) from the same address.
      const latest = await ctx.db.submissions
        .withIndex("by_email", (range) => range.eq("email", clean.email))
        .order("desc")
        .first();
      if (latest && latest.message === clean.message) return { ok: true };
      await ctx.db.submissions.insert(clean);
      return { ok: true };
    }),
  },
});
