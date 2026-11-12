# Effect sets number their places, and a binding that runs away within a pass is widened there

Status: implemented. Follows
[2026-11-08-effects-solver-scale.md](2026-11-08-effects-solver-scale.md) and
[2026-11-08-effects-widening.md](2026-11-08-effects-widening.md).

## Problem

`first check app --json` on the files-sdk scratch tree (a local copy of `examples/files-sdk` whose
`node_modules` carry hand patches past unrelated refusals, which other changes are fixing in the
compiler) did not finish once the
layers in front of the effects solver compiled. On main `dd69fc27`, which includes #263, it was
killed at a 10 GB cap after 2:47 (`/usr/bin/time -v systemd-run --user --scope -p MemoryMax=10G
-p MemorySwapMax=0 -- timeout 300 first check app --json`).

## Measurements

Temporary counters in `Graph::solve`, printed at the end of each pass, release build, on main
`dd69fc27`. "Distinct" is the number of different places across all sets of one kind.

| at the last pass before the kill | sets | places in all sets | distinct places |
| --- | ---: | ---: | ---: |
| `write_events` | 1,744 | 11,311,539 | 17,962 |
| `events` | 580 | 1,403,109 | 8,414 |
| `function_writes` | 166 | 654,000 | 9,548 |
| `function_numeric` | | 615,291 | 8,406 |

The solve restarted 6 times (widened 0 → 31 → 50 → 69 → 87 → 324 → 340 bindings over 34 passes),
and the largest group (places with two or more steps below one binding, in one set) at the last
pass was 172. The existing widening did fire. It could not keep up, because it widens the
bindings it sees at the end of a pass, and memory ran out inside a pass.

The lead from the earlier trace was "every event duplicates its callee's summary". That holds
for part of the growth (below), but there were three causes, measured one at a time by disabling
rules in a scratch build (none of these experiments is sound; they only locate the growth):

1. **Unknown calls.** Each of the 1,129 call events to code the solver can't see gets every
   escaped place of its owner and every unowned escaped place, plus the owner's external
   bindings, all closed under aliases. Within one owner, every such call event held the same
   set: 353 distinct sets for 1,129 call events. Turning this rule off kept `write_events` at
   108K places at pass 4 instead of millions.
2. **Growth within one pass.** With rule 1 off, the solve was still killed at 10 GB, in the alias
   expansion of pass 4. One event set went from 1 to 360,058 places in that one expansion, over
   425 bindings with 8,603 places each, none of them widened yet. The end-of-pass check for
   `WIDEN_ABOVE` never ran.
3. **Callee summaries copied into every call event.** A summary place the callee doesn't own
   goes to the caller unchanged, into the call event and the caller's summary. With 2 handled and
   rule 1 off, the solve finished at 5.9 GB with 6.0M `events` places (16.5K distinct) and 6.5M
   `write_events` places (19.2K distinct). The post-loop unions (`capture_writes`,
   `expression_writes`, `loop_writes`) then added 4.5 GB on their own.

Each stored place was a `Place` (a `Span` and a `Vec<Step>`, with a `String` per field step)
in an `IndexSet` bucket, so a set membership cost about 100 bytes and a hash of the whole path.
11.3M memberships is about 8.5 GB of RSS, matching what the kill reported.

## Change

The rules, and so the fixpoint for a given widened set, stay the same. Two changes:

**1. Places are numbered once.** `Graph::places` holds every place the four solver-grown sets
(`events`, `write_events`, `function_numeric`, `function_writes`) refer to, and those sets hold
`u32` numbers in insertion order plus a bitset for membership (`IdSet`). The solved `Effects`
keeps the table and the numbers for `events`, `write_events`, `capture_writes`,
`expression_writes` and `loop_writes`. A membership now costs 4 bytes plus a bit. With this:

- A callee summary place that passes to the caller unchanged keeps its number
  (`CallerEffects::Same`): no clone and no rehash.
- Alias expansion computes one place's alias targets once per pass (`alias_targets`), as
  numbers, shared by every set that contains the place. A new alias edge clears the cache.
- The post-loop unions merge numbers through one reused bitset.
- `widening_candidates` counts each group incrementally from where the last pass stopped,
  because sets only grow within a solve. It was a full scan of every set on every pass, and the
  slowest step after the change (22 s of 66 s on files-sdk).

This changes no solved fact. All 143 repository programs that reach the solver have
byte-identical `FIRST_DEBUG_EFFECTS` dumps (see Result).

**2. A JavaScript-owned binding that runs away within a pass is widened in that pass.** While
alias expansion closes one set, it counts the places it adds per binding. When a
JavaScript-owned binding that isn't widened yet gets more than `RUNAWAY_ABOVE` (1024) places with
two or more steps in that one set, the binding joins `widened` at once, the alias-target cache is
cleared, and the solve ends at the end of the pass with that binding among those to widen.
`Effects::analyze` then restarts from the initial graph, as for the end-of-pass check. The places
added before the cut are thrown away with the attempt.

## Soundness

Change 1 is a change of representation: every set holds the same places in the same order, and
every consumer reads them through the table. The dumps prove it on the 143 programs.

Change 2 only changes **when** a binding joins the widened set, never **which kind** of binding
or **what** widening does. The binding is JavaScript-owned and has a group above 1024, which is
above `WIDEN_ABOVE` (64). The end-of-pass check of the same pass would have widened it anyway if
the pass had been able to finish, so the final widened set only gains bindings that the existing
rule would have chosen. Every attempt that ends with `Err` is discarded, and the final solve
runs with a fixed widened set from the initial graph, so the argument of the widening decision
applies unchanged: the final effects are the least fixpoint of the widened rules for the final
widened set, every exact place is covered by a widened place, and the consumer table there shows
that covering places make the compiler only more conservative (wider types, more `Ty::Dynamic`,
more dropped refinements, broader hook capabilities, or a refusal).

The final widened set can be larger than it would have been without the cut, because a binding
that would only have reached the end-of-pass check after other bindings had been widened is now
widened first. That makes the result coarser, which is the safe direction.

**Determinism.** The cut happens at a point that depends only on the set being expanded, the
order of its pending places and the alias edges, all of which come from the program in source
order (every collection in `effects.rs` is an `IndexMap`/`IndexSet`). The regression test dumps
its effects twice in fresh processes and requires identical dumps, as the widening test does.

**Why 1024.** At `RUNAWAY_ABOVE` = 64 (the same bound as `WIDEN_ABOVE`),
`tests/differential/class-private.ts` widens one more binding than main (its effects dump has
489,279 facts instead of 481,130), because that binding's group passes 64 within a pass and then
would have stopped growing. Its PHP and diagnostics stay the same, but the effects differ for no
benefit. At 1024 every repository program has the same widened set and dump as main. On the
files-sdk tree:

| `RUNAWAY_ABOVE` | time | peak RSS |
| ---: | ---: | ---: |
| 64 | 60 s | 0.92 GB |
| 256 | 64 s | 0.76 GB |
| 1024 | 61 s | 0.74 GB |
| 4096 | 197 s | 2.6 GB |
| off (numbering only) | 156 s | 2.6 GB |

One release build with the bound read from an environment variable, one run each, in this order,
on a shared machine. Every row reports the same diagnostics.

## Result

Release builds on the same machine, `/usr/bin/time -f '%e s %M KB'`, main `dd69fc27` against this
branch.

| program | main | this change |
| --- | --- | --- |
| files-sdk scratch tree, `first check app --json` | killed at 10 GB after 2:47 | 47 to 65 s, 0.74 GB (4 runs) |
| the regression test's object graph (12 nodes) | 16.4 s, 3.5 GB | 0.05 s, 19 MB |
| the same, debug build | 88 s, 3.5 GB; 92.5M projections for 61,717 facts | 0.29 s, 32 MB; 21,558 projections |
| `tests/differential/cases.ts` | 0.50 s, 218 MB | 0.13 s, 48 MB |
| `tests/differential/class-private.ts` | 0.71 s, 133 MB | 0.10 s, 23 MB |

Fact counts (`FIRST_DEBUG_EFFECTS_WORK`, debug builds; `facts` is the sum of all solved sets):

| program | main facts | this change facts | main projections | this change projections |
| --- | ---: | ---: | ---: | ---: |
| `cases.ts` | 1,006,832 | 1,006,832 | 1,466,839 | 72,090 |
| `class-private.ts` | 479,754 | 479,754 | 3,493,322 | 147,309 |
| object graph, 8 nodes | 28,373 | 28,373 | 41,611,861 | 14,462 |

On the files-sdk tree the solved effects hold 58.9M facts (19.6M `write_events` places over 1,766
events, 28.3M `expression_writes` places over 14,203 expressions, 5.1M `events`, 5.0M
`capture_writes`, 0.9M `loop_writes`), with 932 bindings widened. That is the size of the result.
Numbered, it fits in 0.74 GB; as `Place` values it would not fit in 10 GB.

Path projections drop because a place's alias targets are computed once per pass instead of
once per set that holds the place.

Every repository program, built with main and with this branch (`examples/*`, `tests/fixtures/*`,
`tests/differential/*.ts`, `tests/differential/language/*.ts`; 259 programs):

| outcome | programs |
| --- | ---: |
| effects dump identical, `check --json` identical, build tree identical | 52 |
| effects dump identical, `check --json` identical, build refused identically | 91 |
| stops before the solver; `check --json` and build output identical | 116 |
| any difference | 0 |

Build trees are compared with `diff -r` after removing the plugin `.zip` archives, whose
timestamps differ per build.

## What the files-sdk tree reports next

With the solve finished, the first diagnostic is
`F4001` `` `Reflect` isn't defined `` at `files-sdk/dist/chunk-xczk9qxg.js:671:25`, the
`for (const key of Reflect.ownKeys(surface))` in the plugin-extension loop of `Files`.

## Not solved here

- The unknown-call rule (cause 1) still gives every call event of one owner the same large set.
  With numbering it costs 4 bytes a place, and files-sdk fits easily, but one shared set per owner
  would remove the copies entirely. That changes how `write_events` is stored per event and is
  left for when a program needs it.
- Typed bindings are still never widened, as before.
