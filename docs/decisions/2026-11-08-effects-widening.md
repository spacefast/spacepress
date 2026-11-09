# Widening large JavaScript place sets in the effects solver

Status: implemented. The read-side fix landed separately in #239; the widening is in the PR
stacked on it. Follows
[2026-11-08-effects-solver-scale.md](2026-11-08-effects-solver-scale.md),
whose "Not solved here" section this addresses.

## Problem

`zero check` on an app that calls `picomatch.makeRe("src/*.ts", { dot: true }).source`
and `picomatch("*.md")(s)` does not finish. #227 stopped it after 784 s at 9.9 GB. The exact
least fixpoint holds about 350M places over 103 events. That is the real size of the
analysis result, so a faster schedule can't help. The analysis needs a coarser abstraction
for the bindings that cause the growth.

## Measurements

The numbers come from a throwaway prototype in a scratch worktree, not from this branch.
The release build runs on Apple Silicon. `pm3` is the app above, and `pm5` imports only
`picomatch/lib/parse.js`. Both use picomatch 4.0.7 with the two `__proto__: null` lines
removed from `lib/constants.js`, because on main those lines stop the build first with
`Z1002` ("prototype setter syntax").

A **group** is the set of places with a path of two or more steps that start at one
binding, inside one place set (`events[e]`, `write_events[e]`, `function_numeric[f]`,
`function_writes[f]`, `numeric`, `writes`, `incoming` or `incoming_writes`). Bindings are
split by owner. A binding is **JavaScript-owned** when its owning function (`Graph::bindings`)
is in `javascript_functions`, or when the binding is the span of such a function. Every
other binding is typed or synthetic.

Largest group in the exact solve, measured at the end of each pass:

| program | largest JavaScript-owned group | largest typed group | facts at fixpoint |
| --- | ---: | ---: | ---: |
| `tests/differential/cases.ts` | 42 | 465 | 424,225 |
| `language/bitwise.ts` | 22 | 61 | 19,152 |
| `language/destructuring-assignment.ts` | 15 | 145 | |
| `tests/differential/class-private.ts` (through `class-private-lib.mjs`) | 249 | | 610,072 exact, 406,504 widened |
| every other program of the 106 that reach the effects pass | ≤ 12 | ≤ 79 | ≤ 40,819 |
| `pm5` (`parse.js` alone) | 766 | 155 | 10.9M (13 s, 5.0 GB) |
| `pm3` (makeRe app), after 3 passes | 4,664 | 782 | 26M and still growing |

The 106 programs are `tests/differential/{cases,classes}.ts`, `tests/differential/language/*.ts`,
`examples/*/zero.config.ts` and `tests/fixtures/*/zero.config.ts`. The other 93 stop before
the effects pass. `examples/files-sdk/app` stops at the syntax pass (`Z1101`, computed class
methods), so it is not among the 106.

The growth sits in bindings owned by JavaScript functions. In `pm3`, about 400 of them
(`tokens`, `prev`, `state`, `tok` and similar in `parse.js`) each collect up to 4,664
distinct paths of length ≤ 5 over ~50 field names.

## Every consumer of the solved `Effects`

All reads go through methods on `Effects` (`src/compile/effects.rs`). Except for one call in
`classes.rs` to the free function `class_static_read`, which doesn't read `Effects`, every
caller is in `src/compile.rs`. `annotations.rs`, `host.rs` and `javascript.rs` don't read
`Effects`.

| field | read by | callers in `src/compile.rs` | decision it drives in generated PHP |
| --- | --- | --- | --- |
| `reassigned` | `binding_reassigned` | `:1233` parameter declaration | `native_object`: a typed `\Zero\JsObject` parameter that is never reassigned reads fields as `$x->p['k'] ?? dataGet(...)` (`:6050`) and writes them as `WriteKind::NativeObject` (`:5594`, `:5651`). Otherwise it uses `dataGet` / `WriteKind::Object`. |
| `captured` | `captured` | `:1762` `for (let ...)`, `:2391` `fresh_binding` | A fresh `\Zero\Js::cell` per iteration for captured loop bindings, and `unset($x)` before rebinding a captured name. This is the mutable-capture decision. |
| `captured_data` | `captured_data_type` → `read_view_type` | `:4203` | Read type of build-time data captured by a closure. Numbers that are mutated widen from literal to `number`. |
| `numeric` | `read_view_type`, `capture_type` | `:2884` `narrowed_path` in loops, `:3860` `ident` in loops, `:1415` via `capture_type` | Numeric widening of a read view: literal → `number`, non-empty array → array, dynamic step → `Ty::Dynamic`. |
| `incoming` | `parameter_type` (widen) | `:1325` `declare_local`, `:2379` `declare_binding`, `:4636` `initialize_parameter` | Read type of a parameter or a destructured binding, widened by what callers did before the call. |
| `incoming_writes` | `parameter_type` (restore) | same | Drops refinements of a parameter's sub-paths that a caller wrote before the call. |
| `events` | `write_type` | `:3635` `apply_effects`, after `invalidate` | Numeric widening of every local's view after a call, assignment or update event. |
| `write_events` | `invalidate` | `:3634` `apply_effects` | Drops narrowed types (back to the authored constraint, or to `Ty::Dynamic` for dynamic steps) for locals that an event may write. |
| `loop_writes` | `invalidate_loop` | `:1738`, `:1923`, `:1997`, `:2020`, `:2043`, `:2186` | Drops narrowings at loop entry for anything the loop body may write. |
| `capture_writes` | `capture_type` | `:1415` `resolve` of a captured local | Drops a captured local's narrowings that the closure, or anything that may run before it, writes. |
| `expression_writes` | `changes_refinement` | `:2827` `refinement_survives` | Whether a narrowing from `a && b` / `a ? b : c` survives into `b`. |
| `binding_writes` | `writes_below` | `:535` `hook_writes` | Capabilities of a plugin before-hook: a `write <key>.<field>` per column the hook writes on `data`, and `*` for anything else. The plugin capability gate checks these. |

The analysis has no copy-on-assign decision and no alias-refusal decision. `grep` finds no
consumer of this kind. PHP copy-on-assign follows from value types (`JsObject`/`JsArray`
are handles), not from `Effects`.

## Direction of each consumer

To show that widening is safe, I need one claim per consumer: if the set gets larger, or a
place is replaced by a coarser place that covers it (defined below), the compiler can only
get more conservative. The type gets wider or becomes `Ty::Dynamic`, a refinement is
dropped, a capability is added, or the build is refused. The generated PHP must never
compute a different value.

The argument depends on an existing contract: **`Ty::Dynamic` compiles to the checked
`\Zero\Js` helpers that implement JavaScript semantics, and a typed position refuses it.**
`assignable(Dynamic, T)` is false for every `T` other than `Dynamic` and `Unknown`
(`compile.rs:10038`: no match arm takes a `Dynamic` source). Every local
in imported JavaScript is already `Ty::Dynamic` (`:1618`), so this contract already carries
all compiled JavaScript. I have not audited every match arm on `Ty::Dynamic` to confirm the
checked path is always exact. That is an existing assumption, not something this change
adds.

| consumer | how it matches places | larger set ⇒ | safe? |
| --- | --- | --- | --- |
| `invalidate`, `invalidate_loop`, `capture_type` (via `invalidate_paths`) | `projected_suffix` in both directions. `DynamicDescendants` in the place path matches any remainder of the view. | more `restore` calls. `restore` returns the constraint or `Ty::Dynamic`, never something narrower. | yes |
| `changes_refinement` | `projected_suffix` in both directions | more refinements dropped | yes |
| `parameter_type` | applied from the root, no matching | more `widen` / `restore` | yes |
| `write_type` | **`path.starts_with(view)`** | more `widen` | yes, but see the gap below |
| `read_view_type` | **`path.starts_with(view)`** | more `widen` | **no, see the gap below** |
| `writes_below` → `hook_writes` | first step of the path | more fields, or `*`, so the plugin needs a broader grant and gets refused otherwise | yes |
| `reassigned` | places with an empty path | widening never creates or removes an empty path (see the rule) | unchanged |
| `captured`, `captured_data` | not computed by the fixpoint | — | unchanged |

### The gap: `read_view_type` and `write_type` match by exact prefix

Suppose the solver widens `x.a.b` to `x.a.DynamicDescendants`. A narrowed member path whose
view is `[a, b]` then no longer matches, because `[a, DynamicDescendants]` does not start
with `[a, b]`. The exact place `x.a.b.DynamicValue` would have matched and turned the view
into `Ty::Dynamic`.

- `write_type` is protected today. `apply_effects` calls `invalidate` on `write_events`
  first, with `projected_suffix`, and that already turns the view `Ty::Dynamic`. That relies
  on `events ⊆ write_events`. It holds by construction: every place inserted into
  `events` or `function_numeric` is also inserted into `write_events` or `function_writes`,
  and the same rules close both. I checked all 106 dumps and found 15,096 `events` places,
  0 of them missing from `write_events`.
- `read_view_type` has no such protection. In a loop, `narrowed_path` (`:2884`) and
  `capture_type` (`:1415`) read the global `numeric` set. That set holds numeric writes from
  any reachable function, not just the ones in `loop_writes` or `capture_writes`. A widened
  place could therefore leave a narrowed `number` literal in place while JavaScript stores a
  string there on a later iteration. **Without a consumer change, the widening is not
  sound.**

**Fix (#239, landed first as its own PR):** `read_view_type` and `write_type` use one
helper, `below_view`. A place matches a view when its path starts with the view, as
before, or when its path has `Descendants` or `DynamicDescendants` at a position
`i < view.len()` and `path[..i] == view[..i]`. In the second case the view is widened by that
tail: `Descendants` widens numbers inside the view, and `DynamicDescendants` turns it into
`Ty::Dynamic`. That is the same coverage `projected_suffix` already gives these steps.

Main already has both kinds of cut places: `bounded()` cuts paths at `max_depth`, and
`DynamicDescendants` alone accounts for 3,465 dump lines over the 106 programs. So #239 also
closes this gap for depth cuts. No program reproduces the gap on main; #239 pins the rule
with unit tests. Building all 200 programs with `origin/main` and with #239 gives
byte-identical output trees and identical refusals.

## The widening rule

**What it produces.** For a widened binding `b`, a place `b.[s0, s1, …]` with two or more
steps becomes `b.[s0, DynamicDescendants]`. Places with zero or one step are unchanged. The
step is the existing `Step::DynamicDescendants`, not `Descendants`, for three reasons:

- JavaScript writes already record a `DynamicValue` step (`effects.rs:1131`), and with
  `Descendants` the widened place would lose it. `widen` / `restore` would then only widen
  numbers, while the exact place made the value `Ty::Dynamic`. That would be unsound.
- `projected_suffix` treats `DynamicDescendants` in the place path as matching anything
  after the shared prefix. Every solver rule and every consumer that uses `projected_suffix`
  therefore sees the widened place cover every place it replaces.
- I tried `Descendants` with a wildcard in `projected_suffix`. It changed effects in 31 of
  the 106 programs and changed the diagnostic of `examples/stuff-drawer`. A `DynamicDescendants`
  terminal changes nothing unless a binding is widened.

Keeping the first step keeps field-level separation (`state.output` stays apart from
`state.index`). After widening, a group holds at most one place per first step. In `pm3` the
largest group falls to 15.

**Covering.** Place `q` covers place `p` when they share a binding and, for every prefix
`v`, if `projected_suffix(p.path, v)` is `Some(s)` then `projected_suffix(q.path, v)` is
`Some(t)` with `t` covering `s`. `[s0, DynamicDescendants]` covers `[s0, s1, …]`: on the
step `s0` both match or both fail, and after it `DynamicDescendants` matches whatever is
left. The two places where a rule skips an empty suffix (`caller_effects`: assigning a
parameter does not replace the argument; `expand_aliases`: copying a slot does not alias
later replacements) only add more for the widened place. Its suffix is `[DynamicDescendants]`
where the exact suffix was empty, so the rule adds a place it would have skipped. No path
becomes empty, so `reassigned` cannot change.

**Which bindings.** JavaScript-owned bindings only. Typed and synthetic (captured data,
class) bindings are never widened directly, because typed code depends on their exact
paths for its types. They can still receive widened places through call edges and aliases.
For example, a typed handler passes `o` to a JavaScript `touch(o)` that writes `o.a.b`. If
`touch`'s parameter is widened, typed code sees `o.a` as `Ty::Dynamic` instead of only
`o.a.b`. That is coarser, and it can cause a refusal where a typed sink receives the value.
It cannot cause a wrong result.

**When it fires.** At the end of each solver pass, `Graph::widening_candidates` counts
every group of every JavaScript-owned binding that is not yet widened. If any group is
larger than `N` (`WIDEN_ABOVE`), all such bindings join the widened set `W`, `solve` returns
them, and `Effects::analyze` **restarts from a clone of the initial graph** with the larger
`W`. At the start of a solve the initial effect sets are coarsened once. After that, every
place a rule derives into an effect set goes through `derived` (cut at the depth bound,
then coarsened): call summaries, entry views, `caller_effects`, alias expansion, the
`Descendants` writes for escaped places at unknown calls, and parameter views. `values` and
`slice_methods` stay exact (`bounded` without widening), because they decide call edges and
were never large (68 values, 2,184 slice methods in `parse.js`).

**Why restart instead of widening during the solve.** #227 reads each set through cursors
that assume the set only grows, so exact places can't be removed once they are in it. With
widening during the solve (no restart), the stale exact places keep propagating: at
`N = 64`, `pm3` took 83 s and 21 GB. With restart it takes 16 s and 2.9 GB.

**Monotone and finite.** Within one solve `W` is fixed, so the widening is a fixed function
applied to each rule's output. Each rule still only adds facts and still adds more when its
inputs grow, so #227's argument still holds: the solve reaches the least fixpoint of the
widened rules whatever the schedule, and it terminates because places live in a finite set
(at most `max_depth + 1` steps over finite bindings and steps). Every restart adds at least
one binding to `W`, and `W` is a subset of the finite set of JavaScript-owned bindings, so
there are at most that many restarts. `pm3` restarts 4 times. By induction on derivations,
every place in the exact fixpoint is covered by a place in the widened fixpoint: each rule
applied to covering inputs yields covering outputs, and the widening only replaces places
with places that cover them. The consumer table above shows that covering places make the
compiler more conservative, given the `read_view_type` fix.

**Determinism.** The final effects are the least fixpoint for the final `W`, so they depend
only on `W`. `W` depends on which groups exceed `N` at the end of each pass. Today those
intermediate states could depend on `HashMap` iteration order, because the solver's maps
(`events`, `write_events`, `function_numeric`, `function_writes`, `call_events`, `Call::prior`
and `external`) used std's random seed. Every map and set in `effects.rs` is now an
`IndexMap` / `IndexSet`. Graph construction walks the program in source order, so every
collection the solver iterates has an order that is a function of the program, and so are
`W` and the PHP. That also keeps native and WASM output identical. It changes no fixpoint,
because the fixpoint never depended on order. All 106 effects dumps are byte-identical to
`origin/main`.

`widened_effects_are_deterministic_and_keep_php_equal_to_node` in
`tests/compiler_contracts.rs` dumps a widened program twice in separate processes (fresh hash
seeds) and requires identical dumps. It fails if the choice of bindings depends on hash
order. I checked this by making `solve` return one binding taken from a `std::HashSet`: three
of three runs failed. It also fails if the threshold is disabled (`usize::MAX`), because its
program must reach widening.

**Threshold.** `N = 64` (decided), applied per group, with a restart from scratch. The
measurements below come from the prototype that preceded the implementation.

| `N` | `pm3` time | `pm3` peak RSS | restarts | widened bindings |
| ---: | ---: | ---: | ---: | ---: |
| 64 | 16 s (3 runs: 15.6 to 16.4 s) | 2.9 GB | 4 | 394 |
| 128 | 28 s | 5.0 GB | 3 | 266 |
| 256 | 63 s | 10.8 GB | 3 | 214 |
| widen every JavaScript-owned binding from the start | 3.3 s | 0.63 GB | 0 | all |

Among the 106 measured programs the largest JavaScript-owned group is 42 (`cases.ts`); the next
are 22 (`language/bitwise.ts`) and 15 (`language/destructuring-assignment.ts`). So 64 leaves a
margin of 1.5× over those. One existing program outside that set does cross it:
`tests/differential/class-private.ts`, whose `class-private-lib.mjs` has groups of 249. It
widens 22 bindings; every exact fact is still covered by the widened result (609,087 checked),
`reassigned` and `captured` are unchanged, and its build and Node-parity output are identical. Widening every JavaScript-owned binding from the start was
rejected, because it refuses `language/bitwise.ts`. The first diagnostic with widening is `` `SyntaxError` isn't
defined ``. For `pm5` it is at `parse.js:368`. For `pm3` it is at `parse.js:1344`, the same
`throw new SyntaxError(...)` in `parse.fastpaths`, which `makeRe` reaches first. The
expected `parse.js:368` applies to the `parse()`-only repro.

## Cost: which programs can compile differently

1. **Programs where no JavaScript-owned group exceeds `N`.** This is all 106 measured
   programs (largest 42). `W` stays empty, the widening is the identity, and nothing
   restarts, so the `ZERO_DEBUG_EFFECTS` dumps are byte-identical. The determinism change
   doesn't alter any fixpoint. Both are checked; see Result.
2. **The `read_view_type` / `write_type` fix** (#239) could have changed PHP on main
   wherever a cut place lies inside a narrowed member view. No program changes: all 200
   build to byte-identical output.
3. **Programs above the threshold.** Today these are only apps that import large JavaScript
   such as picomatch. They don't finish on main, so nothing they produce today can regress.
   Once they compile:
   - in imported JavaScript, locals are already `Ty::Dynamic`, so the main effect is that
     narrowings of member paths are dropped more often, which means more checked helpers;
   - in typed code that passes objects into that JavaScript, a whole subtree under the
     first step becomes `Ty::Dynamic` where only one path did before. That can cause new
     refusals such as "this argument is a JavaScript value[], but the function expects
     number[]".

     I saw exactly this when I widened every JavaScript-owned binding regardless of size:
     `language/bitwise.ts` was refused, while `cases.ts`,
     `installed_package_typescript_is_type_erased_like_javascript_and_matches_node` and
     `language_construct_type_rules` still passed. The threshold rule leaves `bitwise.ts`
     unwidened (largest group 22).
   - `hook_writes` can request `*` instead of single fields for a plugin before-hook that
     passes `data` into widened JavaScript, which means a broader grant or a refusal.

## Result

Release build, Apple Silicon, two runs each. Both picomatch apps use 4.0.7 with the two
`__proto__: null` lines removed from `lib/constants.js` by hand.

| program | `origin/main` | this change | first diagnostic |
| --- | --- | --- | --- |
| `picomatch.makeRe("src/*.ts", { dot: true }).source + String(picomatch("*.md")(s))` | not finished (784 s, 9.9 GB in #227) | 16.3 to 16.9 s, 2.9 GB | `Z4001` `` `SyntaxError` isn't defined `` at `parse.js:1344:15` |
| `parse(s, {}).output` (`picomatch/lib/parse.js` only) | 13 s, 5.0 GB | 3.5 s, 0.98 GB | `Z4001` `` `SyntaxError` isn't defined `` at `parse.js:368:15` |
| the regression test's token parser | 1.35 s, 0.14 GB | 0.29 s, 0.06 GB, 34 bindings widened | none; PHP equals Node on 6 inputs, with and without widening |

Programs under the threshold are unchanged:

- The `ZERO_DEBUG_EFFECTS` dumps of all 106 programs that reach the solver are
  byte-identical to `origin/main`, and so are their `zero check --json` outputs.
- `zero build` of all 200 programs gives byte-identical output trees and identical refusals.
- A wider check of 238 programs (the 200 plus `class-private`, `host-globals` and the rest of
  `tests/differential/`) found one that crosses the threshold, `class-private.ts`. Its dump
  differs; the other 137 that reach the solver are byte-identical, and all 238 have identical
  `check --json` output, build trees and refusals.

## Not solved here

- Typed bindings are never widened. A typed program whose own groups grow like `parse.js`
  would still be slow. No measured program comes close: the largest typed group is 470 in
  `cases.ts`, and the solve finishes.
- A single pass can grow 100× (in `pm3`, pass 3 goes from 43k to 4.6M facts in 2 s). At
  `N = 64` that stays under 3 GB. If a later program overshoots inside one pass, the
  threshold check can move from the end of the pass to the end of each phase within it.
- The files-sdk path still stops earlier on `Z1002` for picomatch's `__proto__: null`
  object literals, so it does not reach the solver on main. After that is fixed, the next
  refusal is `` `SyntaxError` isn't defined ``.
