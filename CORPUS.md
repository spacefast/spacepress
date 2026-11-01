# Aliasing refusal corpus

Test input for compiling JS objects to a PHP handle type. Each case was a false negative of one of
the two static aliasing designs on this branch (union-find, 9 Sol rounds; ownership rule, 3 rounds)
or a reviewer finding; all of them compile to PHP that disagrees with Node, because JS objects and
arrays are references and compiled PHP arrays are values (copied on assignment, return and pass).

Each body is an access-rule body (`ctx` in scope) returning a boolean. **Node** is what the body
returns under Node. Every `true` asserts a change JS makes visible through a second name; compiled
PHP, which copied the container, makes it invisible (`false`). The two `false` rows are paths Node
doesn't take at runtime (a `catch` that never runs, a comparator called in another order): there
JS and PHP agree by luck, and the designs refused them for the path that would diverge.

A handle-type design is done when every row compiles and returns what Node returns.

Source of truth: `tests/compiler.rs` `rejects_phase2_static_contracts` on this branch (the
diagnostic each design gave is next to each case there).

| # | Body | Node |
|---|------|------|
| 1 | `const a = { x: 1 }; const b = a; b.x = 2; return a.x === 2;` | true |
| 2 | `const a = [1]; const b = a; b.push(2); return a.length === 2;` | true |
| 3 | `const o = { inner: { x: 1 } }; const { inner } = o; inner.x = 2; return o.inner.x === 2;` | true |
| 4 | `const list = [{ x: 1 }]; const f = list.find((e) => e.x === 1); if (f) f.x = 5; return list[0]?.x === 5;` | true |
| 5 | `const same = (v: { x: number }) => v; const a = { x: 1 }; const b = same(a); b.x = 2; return a.x === 2;` | true |
| 6 | `const a = { inner: { x: 1 } }; const b = { ...a }; b.inner.x = 2; return a.inner.x === 2;` | true |
| 7 | `const list = [{ x: 1 }]; list.forEach((e) => { e.x = 9; }); return list[0]?.x === 9;` | true |
| 8 | `const a: number[] = []; const box = { a }; a.push(1); return box.a.length === 1;` | true |
| 9 | `const a = [{ x: 1 }]; const e = a.at(0)!; e.x = 2; return a[0]!.x === 2;` | true |
| 10 | `const a = [{ x: 1 }]; const b = a.slice(); b[0]!.x = 2; return a[0]!.x === 2;` | true |
| 11 | `const a = { x: 1 }; const b = a; const change = () => { b.x = 2; }; change(); return a.x === 2;` | true |
| 12 | `const bump = (v: { x: number }) => { v.x++; }; const a = { x: 1 }; const b = a; bump(b); return a.x === 2;` | true |
| 13 | `const bump = (v: { x: number }) => { v.x++; }; const list = [{ x: 1 }]; list.forEach(bump); return list[0]!.x === 2;` | true |
| 14 | `const a = { x: 1 }; let b = a; if (a.x > 5) b = { x: 0 }; b.x = 2; return a.x === 2;` | true |
| 15 | `const a = { x: 1 }; let b = { x: 0 }; for (let i = 0; i < 2; i++) { b.x = 9; b = a; } return a.x === 9;` | true |
| 16 | `const keep = (v: number[]) => v; const a = [1]; const b = keep(a); a.push(2); return b.length === 2;` | true |
| 17 | `const read = (p: { x: number }) => { const q = p; p.x = 1; return q.x; }; return read({ x: 0 }) === 1;` | true |
| 18 | `const a = { x: 0 }; const f = () => { a.x++; }; const b = a; f(); return b.x === 1;` | true |
| 19 | `const a = [{ x: 0 }]; const b = a.map((e) => e); b[0]!.x = 1; return a[0]!.x === 1;` | true |
| 20 | `const a: { x: number }[] = []; a.push({ x: 0 }); const b = a[0]!; b.x = 1; return a[0]!.x === 1;` | true |
| 21 | `const a = { x: 0 }; const list = [a]; for (const item of list) item.x = 1; return a.x === 1;` | true |
| 22 | `const a = { x: 0 }; let b = a; try { JSON.parse('x'); } catch { b = { x: 9 }; } b.x = 1; return a.x === 1;` | false |
| 23 | `const a = { x: 0 }; let b = { x: 5 }; for (let i = 0; i < 2; i++) { b = a; if (i === 0) break; b = { x: 0 }; } b.x = 1; return a.x === 1;` | true |
| 24 | `const fs: (() => number)[] = []; for (let o = { x: 0 }; o.x < 1; o.x++) fs.push(() => o.x); return fs[0]!() === 1;` | true |
| 25 | `const o: { l: { x: number }, r: { x: number } } = { l: { x: 0 }, r: { x: 0 } }; o.r = o.l; o.l.x = 1; return o.r.x === 1;` | true |
| 26 | `const a = [{ x: 0 }]; const b = a.map((e) => e); a[0]!.x = 1; return b[0]!.x === 1;` | true |
| 27 | `const both = (a: { x: number }, b: { x: number }) => { a.x = 1; return b.x; }; const o = { x: 0 }; return both(o, o) === 1;` | true |
| 28 | `const a = [{ x: 0 }]; Array.from(a, (e) => { e.x = 1; return 0; }); return a[0]!.x === 1;` | true |
| 29 | `const a = [{ x: 0 }, { x: 0 }]; a.sort((x, y) => { y.x = 1; return 0; }); return a[0]!.x === 1;` | true |
| 30 | `const identity = (p: { x: number }) => p; const forward = (p: { x: number }) => identity(p); const o = { x: 0 }; const r = forward(o); o.x = 1; return r.x === 1;` | true |
| 31 | `const reader = (p: { x: number }) => () => p.x; const o = { x: 0 }; const r = reader(o); o.x = 1; return r() === 1;` | true |
| 32 | `const a = [{ x: 0 }]; const r = a.map((e) => { a[0]!.x = 1; return e.x; }); return r[0] === 1;` | true |
| 33 | `const a = [{ x: 0 }]; const b = a.map((e) => ({ e })); b[0]!.e.x = 1; return a[0]!.x === 1;` | true |
| 34 | `const cmp = (x: { x: number }, y: { x: number }) => { y.x = 1; return 0; }; const a = [{ x: 0 }, { x: 0 }]; a.sort(cmp); return a[1]!.x === 1;` | false |
| 35 | `const acc = (a: { x: number }, e: number) => { a.x += e; return a; }; const init = { x: 0 }; [1, 2].reduce(acc, init); return init.x === 3;` | true |
| 36 | `const reader = (p: { x: number }) => { const q = p; return () => q.x; }; const o = { x: 0 }; const r = reader(o); o.x = 1; return r() === 1;` | true |
| 37 | `const a = [1, 2]; (a.length > 0 ? a : a).reverse(); return a[0] === 2;` | true |
| 38 | `const wrap = (p: { x: number }) => ({ p }); const a = { x: 0 }; const b = wrap(a); a.x = 1; return b.p.x === 1;` | true |
| 39 | `const a = [{ x: 0 }]; const b = a.map((e) => ({ e })); a[0]!.x = 1; return b[0]!.e.x === 1;` | true |
| 40 | `const o = { x: 0 }; const f = (p: { x: number }) => { o.x = 1; return p.x; }; return f(o) === 1;` | true |
| 41 | `const a = [{ x: 0 }]; const b = Array.from(a, (e) => e); a[0]!.x = 1; return b[0]!.x === 1;` | true |
| 42 | `const rows = [{ x: 1 }]; const out: { x: number }[] = []; rows.forEach((r) => { out.push(r); }); out[0]!.x = 9; return rows[0]!.x === 9;` | true |
| 43 | `const rows = [{ x: 1 }]; const out = rows.reduce((acc, r) => { acc.push(r); return acc; }, [] as { x: number }[]); out[0]!.x = 9; return rows[0]!.x === 9;` | true |
| 44 | `const a = { x: 0 }; [a].map((e) => { e.x++; return e.x; }); return a.x === 1;` | true |
| 45 | `const r = [1].reduce((acc, n) => { const q = acc; acc.push(n); return q; }, [] as number[]); return r.length === 1;` | true |
| 46 | `const list = [{ x: 0 }, { x: 0 }]; list.reduce((acc, r) => { acc.x = 1; return r; }, { x: 0 }); return list[0]!.x === 1;` | true |
| 47 | `const reader = (p: { x: number }) => { const box = { p }; return () => box.p.x; }; const o = { x: 0 }; const f = reader(o); o.x = 1; return f() === 1;` | true |
| 48 | `const a = { x: 0 }; [{ child: a }].map((e) => { e.child.x = 1; return e; }); return a.x === 1;` | true |
| 49 | `const a = [{ x: 0 }]; const mutate = () => { a[0]!.x = 1; }; const r = a.map((e) => { mutate(); return e.x; }); return r[0] === 1;` | true |
| 50 | `const a = { x: 0 }; return ({ a, n: (a.x = 1) }).a.x === 1;` | true |
| 51 | `const reader = (p: { child: { x: number } }) => { const q = p.child; return (_: number) => q.x; }; const o = { child: { x: 0 } }; return reader(o)((o.child.x = 1)) === 1;` | true |
| 52 | `const a = [1, 2]; const r = a.map((e) => { a.reverse(); return e; }); return r[1] === 1;` | true |
| 53 | `return [{ x: 0 }].filter((e) => { e.x = 1; return true; })[0]!.x === 1;` | true |
| 54 | `const identity = (p: { x: number }) => p; const reader = (p: { x: number }) => { const q = identity(p); return () => q.x; }; const o = { x: 0 }; const f = reader(o); o.x = 1; return f() === 1;` | true |
| 55 | `const a = { x: 0 }; const r: [{ x: number }, number] = [a, a.x++]; return r[1] === 0;` | true |
| 56 | `const read = (p: { x: number }, n: number) => p.x; const a = { x: 0 }; return read(a, a.x++) === 1;` | true |
| 57 | `const a = [1, 2]; const cb = (e: number) => { a.reverse(); return e; }; return a.map(cb)[1] === 1;` | true |
| 58 | `const rows = [{ x: 1 }]; const keep: { x?: number }[] = []; rows.map((r) => { const o: { x?: number } = {}; keep.push(o); o.x = r.x; return o; }); return keep[0]!.x === 1;` | true |
| 59 | `const deep = (o: { inner: { x: number } }) => { o.inner.x = 1; }; const shared = { x: 0 }; const o = { inner: { x: 0 } }; o.inner = shared; deep(o); return shared.x === 1;` | true |
| 60 | `const a = { x: 0 }; let b = { x: 5 }; const f = () => { b = a; }; f(); b.x = 1; return a.x === 1;` | true |
| 61 | `const a = { child: { x: 0 } }; const b = { ...(a.child.x === 0 ? a : a) }; a.child.x = 1; return b.child.x === 1;` | true |
| 62 | `const shared = { x: 0 }; const list = [{ child: { x: 0 } }]; for (const e of list) { e.child = shared; e.child.x = 1; } return shared.x === 1;` | true |
| 63 | `const read = (p: { x: number }, q: { x: number }) => p.x + q.x; const a = { x: 0 }; let b = { x: 5 }; read(a, b = a); a.x = 1; return b.x === 1;` | true |
| 64 | `const a = [1, 2]; return a.slice(a.pop()! - 2).length === 1;` | true |
| 65 | `const a = { x: 0 }; let b = { x: 9 }; const dst: Record<string, number> = {}; dst[(b = a).x === 0 ? 'x' : 'x'] = (a.x = 1); return b.x === 1;` | true |
