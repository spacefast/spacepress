# The effects solver evaluates new facts only

`zero check` on an app that imports picomatch 4.0.7 `lib/parse.js` (one
1,400-line function) spent minutes in `Graph::solve`
(`src/compile/effects.rs`). The solver re-applied every rule to every fact on
each pass and stopped when a 12-field size tuple stopped changing.

## Measurements (main `c686b390`, release build, Apple Silicon)

Temporary counters printed once per pass. The repro is the brief's
`run.mjs` importing `parse.js`.

| pass | elapsed | reachable | copies | values | slice_methods | incoming | `events` places | `write_events` places |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 s | 2 | 530 | 43 | 11 | 0 | 198 | 358 |
| 3 | 0.18 s | 4 | 535 | 56 | 41 | 19 | 68,310 | 278,851 |
| 4 | 3.5 s | 27 | 680 | 64 | 81 | 89 | 1,327,406 | 3,547,335 |
| 5 | 14.2 s | 31 | 736 | 68 | 114 | 691 | 2,317,428 | 7,829,741 |
| 8 | 53.5 s | 44 | 777 | 68 | 309 | 1,208 | 2,365,690 | 8,022,673 |
| 28 | 365 s | 44 | 777 | 68 | 2,184 | 1,208 | 2,365,690 | 8,022,673 |

The full run took 29 passes, 618 s wall time and 8.4 GB peak RSS
(`/usr/bin/time -l`). It then reported `` `SyntaxError` isn't defined `` at
`parse.js:368:15`.

What grows:

- **Paths stay bounded.** `max_depth` is 4 (longest copy path 3, plus 1).
  The longest path in `values` is 2, and every derived place is cut at
  `max_depth` and ends in `Descendants`/`DynamicDescendants`. Nothing creates
  places without limit, so no widening bound is needed.
- **The sets are large but finite.** After pass 8, only `slice_methods`
  changes. It gains about 100 places per pass (chains such as
  `prev.prev.prev`), because the copies phase reads a snapshot of
  `slice_methods` from the start of the pass. Each pass moves a method one
  copy hop, so the solver needs 20 more passes to finish.
- **Each pass redoes everything.** A pass after pass 5 costs 13 to 18 s even
  when almost nothing is new. `expand_aliases` re-expands all ~10M event
  places from scratch, and the second call loop clones every callee summary
  (`function_numeric`/`function_writes`, ~200k places each) for every call
  edge. It also rescans every prior event set for every argument. Measured
  per phase: alias expansion took 4 to 14 s per pass and the call loop 3 to
  9 s.
- **After the loop**, `capture_writes`, `expression_writes` and
  `loop_writes` union the place sets of their events: 256M insert attempts for
  59k distinct places on this repro (11,456 function/event pairs).

So the problem is iterations × full-pass cost, not unbounded growth.

## Why any evaluation order gives the same result

Each rule in `solve` only adds facts. A rule's output grows when its inputs
grow (the rules are monotone). `numeric` and `writes` are reassigned each pass,
but only to unions of sets that grow. `max_depth` is fixed before the loop, so
`bounded` is the same function on every pass. The loop stops at the least
fixpoint above the initial graph. Every fact it adds is derivable, and the
final state is closed under every rule. A least fixpoint does not depend on
the order the rules run in, or on how much of each rule a pass applies. Any
schedule that applies only these rules, and stops only when every rule
applied to every fact adds nothing, therefore produces the same sets.

## Approach

The rules stay the same. Only the schedule changes:

1. Close `values` and `slice_methods` under the reachable copies inside one
   pass. Use a worklist, with copies indexed by source binding, instead of one
   hop per pass.
2. Make the growing place sets insertion-ordered (`IndexSet`). A consumer
   records how far into a set it has read, so the next pass reads only the
   new suffix:
   - alias expansion expands only new places, plus old places whose binding
     gained an alias edge;
   - callee summaries go to a call edge only for summary places that are new
     to that edge (a new edge starts at 0);
   - entry views read only the new places of `incoming`, `numeric`, `writes`
     and each prior event, and prior events are indexed by binding, so an
     edge reads only the places of its own argument bindings.
3. Call edges come from `values` indexed by binding instead of a scan of every
   value per call.
4. An event that already received its owner's external `Descendants` places
   is not scanned again: the condition only becomes true once, and the places
   it adds never change. Escaped places are indexed by binding for that check.
5. After the loop, places are numbered once, and each event history is unioned
   by number before cloning a place into its result set.

## Proof

A debug-only `ZERO_DEBUG_EFFECTS=<file>` appends each solved `Effects` in
sorted text form. Release builds don't compile the hook. Every program in
`tests/differential/*.ts`, `tests/differential/language/*.ts`,
`examples/*/zero.config.ts`, `tests/fixtures/*/zero.config.ts` and the
files-sdk probe is dumped with main and with this change. The dumps must be
byte-identical. The picomatch repro is compared the same way.

## Result

| program | main | this change |
| --- | --- | --- |
| `parse.js` repro, release | 618 s, 8.4 GB | 13 to 17 s, 4.2 to 5.0 GB |
| synthetic, 60 branches, release | 20 s | 1.3 s |
| synthetic, 240 branches, release | 738 s | 12 to 24 s |

Ranges are runs under different machine load. The result itself holds about
23M places on the `parse.js` repro, so its memory is now mostly the output.

The regression test
(`effects_solver_work_stays_proportional_to_its_result_on_a_large_function`
in `tests/compiler.rs`) bounds path projections per produced fact. Debug
builds count them through `ZERO_DEBUG_EFFECTS_WORK`. On its program, main
makes 51M projections for 1.36M facts (37.7 per fact); this change makes 3.5M
(2.6 per fact). The test fails above 5 per fact.

## Not solved here

`picomatch(glob)` and `picomatch.makeRe(glob)` reach `parse()` from more call
sites. With this change, `zero check` on that app still does not finish: a
signal stopped it after 784 s at 9.9 GB RSS. There the solved event sets reach
millions of places each (one has 5.2M
places over 411 bindings and 50 field names, every path at most `max_depth` +
1 = 5 steps long), about 350M places across 103 events. That is the analysis's
true result size, not repeated work. Making it smaller means a coarser
abstraction, for example widening a place set to `binding.Descendants` past a
size, and that changes results. It needs its own soundness argument and its
own PR.
