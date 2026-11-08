# Refuse named function expressions until their private scope is modeled

JavaScript gives a named function expression a private self-binding distinct from surrounding variables. Zero currently lowers that name like an outer reference. A function named `x` can therefore observe an outer number through `typeof x`, violating JavaScript semantics in both evaluation and generated PHP.

We refuse named function expressions at their source position and suggest anonymous expressions or function declarations. Those forms retain their existing support. The refusal applies to configuration and handler code, including imported JavaScript.

Implementing the private scope would preserve more programs, but it also requires immutable binding semantics, recursive closure identity and parameter-shadowing rules across both execution phases. We accept the smaller supported surface until that scope has an executable contract. Retained npm comparison sources contain no named function expressions after their existing CommonJS adapters.

## Superseded (2026-11-08)

Named function expressions now compile. A named function expression is lowered to a function
declaration in its own scope, returned from an immediately called arrow:
`function name() {}` becomes `(() => { function name() {} return name; })()`. Function
declarations already have JavaScript's hoisting and shadowing rules, so recursion, parameter and
`var` shadowing, and invisibility outside follow. The one remaining difference, the name being
read-only, is enforced at the source: a write to the name in its own body is refused, because
strict JavaScript throws there. Recursive local declarations needed one change: a declaration
with a full signature (or any function in imported JavaScript) is typed before its body compiles,
so the body can call it.
