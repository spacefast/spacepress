import test from "node:test";
import assert from "node:assert/strict";
import { advanceRenewal, monthlyAmount } from "./calendar.ts";

test("calendar renewals clamp month ends and leap days without timezone shifts", () => {
  for (const [day, cycle, expected] of [
    ["2026-01-31", "monthly", "2026-02-28"],
    ["2028-01-31", "monthly", "2028-02-29"],
    ["2028-02-29", "yearly", "2029-02-28"],
    ["2026-12-31", "monthly", "2027-01-31"],
    ["2026-12-31", "yearly", "2027-12-31"],
    ["2026-12-29", "weekly", "2027-01-05"],
    ["2026-03-28", "weekly", "2026-04-04"],
  ]) assert.equal(advanceRenewal(day, cycle), expected);
});

test("monthly cents use 52 weeks per year and keep fractional cents until summing", () => {
  assert.equal(monthlyAmount(12000, "yearly"), 1000);
  assert.equal(monthlyAmount(1200, "monthly"), 1200);
  assert.equal(monthlyAmount(300, "weekly"), 1300);
  assert.equal(Math.round(monthlyAmount(100, "yearly") * 3), 25);
});
