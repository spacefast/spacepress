# Widening large JavaScript place sets in the effects solver

Status: design, not implemented. Follows
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

**Fix (part of this change):** `read_view_type` and `write_type` use one helper. A place
matches a view when its path starts with the view, as today, or when its path has
`DynamicDescendants` at a position `i < view.len()` and `path[..i] == view[..i]`. In the
second case the view becomes `widen(ty, [DynamicDescendants])`, which is `Ty::Dynamic`.

Main already has `DynamicDescendants` places: `bounded()` cuts dynamic paths at `max_depth`,
which produces 3,465 dump lines over the 106 programs. So this fix also closes the same
latent gap for those places, and it can change PHP on main where such a place lies inside a
narrowed member view deeper than `max_depth`. I expect no current program to change. Phase 2
compares the generated PHP of every program to confirm it.

The same latent gap exists on main for `Descendants` (non-dynamic) depth cuts in
`read_view_type`: numeric widening below the cut is missed. Widening never produces
`Descendants`, so this change doesn't fix that. It needs a separate issue.

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

**When it fires.** At the end of each solver pass, the solver counts every group of every
JavaScript-owned binding that is not yet widened. If any group is larger than `N`, all such
bindings join the widened set `W`, and the solve **restarts from the initial graph** with
the larger `W`. The initial sets are rewritten through the widening once, and `bounded()`
applies it to every place it derives. `values` and `slice_methods` stay exact (`bounded`
without widening), because they decide call edges and were never large (68 values, 2,184
slice methods in `parse.js`).

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
intermediate states can depend on `HashMap` iteration order, because the solver's maps
(`events`, `write_events`, `function_numeric`, `function_writes`, `call_events`, `Call::prior`
and `external`) use std's random seed. Three runs of `pm3` gave the same `W` (394 bindings)
and the same result, but that does not prove the result is deterministic. Phase 2 makes every
collection that `solve` iterates either insertion-ordered (`IndexMap` / `IndexSet`) or sorted
before iterating, so `W`, and therefore the PHP, is a function of the program. That also
keeps native and WASM output identical. This doesn't change any fixpoint, because the
fixpoint never depended on order.

**Threshold.** I recommend `N = 64`, applied per group.

| `N` | `pm3` time | `pm3` peak RSS | restarts | widened bindings |
| ---: | ---: | ---: | ---: | ---: |
| 64 | 16 s (3 runs: 15.6 to 16.4 s) | 2.9 GB | 4 | 394 |
| 128 | 28 s | 5.0 GB | 3 | 266 |
| 256 | 63 s | 10.8 GB | 3 | 214 |
| widen every JavaScript-owned binding from the start | 3.3 s | 0.63 GB | 0 | all |

The largest JavaScript-owned group in any existing program is 42 (`cases.ts`), so 64
leaves a margin of 1.5×. The first diagnostic with widening is `` `SyntaxError` isn't
defined ``. For `pm5` it is at `parse.js:368`. For `pm3` it is at `parse.js:1344`, the same
`throw new SyntaxError(...)` in `parse.fastpaths`, which `makeRe` reaches first. The
expected `parse.js:368` applies to the `parse()`-only repro.

## Cost: which programs can compile differently

1. **Programs where no JavaScript-owned group exceeds `N`.** This is all 106 measured
   programs (largest 42). `W` stays empty, the widening is the identity, and nothing
   restarts, so the `ZERO_DEBUG_EFFECTS` dumps are byte-identical. The determinism change
   doesn't alter any fixpoint. Phase 2 checks both claims.
2. **The `read_view_type` / `write_type` fix** can change PHP on main wherever a
   `DynamicDescendants` place from a depth cut lies inside a narrowed member view. The
   change makes the read `Ty::Dynamic`: checked helpers, or a new refusal in typed code. I
   expect zero programs. Phase 2 compares the generated PHP of every program before and
   after, and lists any that change.
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

## Not solved here

- Typed bindings are never widened. A typed program whose own groups grow like `parse.js`
  would still be slow. No measured program comes close: the largest typed group is 470 in
  `cases.ts`, and the solve finishes.
- A single pass can grow 100× (in `pm3`, pass 3 goes from 43k to 4.6M facts in 2 s). At
  `N = 64` that stays under 3 GB. If a later program overshoots inside one pass, the
  threshold check can move from the end of the pass to the end of each phase within it.
- The `Descendants` depth-cut gap in `read_view_type` described above.

## Open questions for review

1. **`N = 64` with restarts (recommended)**, or `N = 128` (28 s, 5 GB, more margin over 42).
2. Widening every JavaScript-owned binding from the start is 5× faster on `pm3`, but it
   changes `language/bitwise.ts` from passing to refused. I don't recommend it.
3. Whether the `read_view_type` fix for `DynamicDescendants` should land as its own PR
   first, since it closes a latent gap on main independently of widening.
