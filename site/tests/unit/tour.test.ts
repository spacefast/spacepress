// Every tour stop still points at real lines of the examples and of what the compiler makes of them.
import { test } from "node:test";
import assert from "node:assert/strict";

import { example } from "../../src/lib/examples.ts";
import { resolveTour } from "../../src/lib/tour.ts";
import { tours } from "../../src/tour/stops.ts";

for (const tour of tours) {
  test(`the ${tour.example} tour's anchors match the example and its build output`, async (t) => {
    const compiled = await example(tour.example);
    for (const stop of resolveTour(tour, compiled)) {
      await t.test(stop.slug, () => {
        assert.ok(stop.config.code.trim().length > 0);
        assert.ok(stop.outputs.length > 0);
        for (const pane of [...stop.inputs, ...stop.outputs]) assert.ok(pane.code.trim().length > 0, pane.label);
        // The frontend design lock owns agents; the tour shows none of that surface.
        for (const pane of stop.outputs) assert.doesNotMatch(pane.code, /agents/, pane.label);
      });
    }
  });
}

test("stop slugs are unique within a tour", () => {
  for (const tour of tours) {
    const slugs = tour.stops.map((s) => s.slug);
    assert.deepEqual([...new Set(slugs)], slugs, tour.example);
  }
});
