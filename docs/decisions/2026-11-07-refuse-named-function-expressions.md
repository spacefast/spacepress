# Refuse named function expressions until their private scope is modeled

JavaScript gives a named function expression a private self-binding distinct from surrounding variables. Zero currently lowers that name like an outer reference. A function named `x` can therefore observe an outer number through `typeof x`, violating JavaScript semantics in both evaluation and generated PHP.

We refuse named function expressions at their source position and suggest anonymous expressions or function declarations. Those forms retain their existing support. The refusal applies to configuration and handler code, including imported JavaScript.

Implementing the private scope would preserve more programs, but it also requires immutable binding semantics, recursive closure identity and parameter-shadowing rules across both execution phases. We accept the smaller supported surface until that scope has an executable contract. Retained npm comparison sources contain no named function expressions after their existing CommonJS adapters.
