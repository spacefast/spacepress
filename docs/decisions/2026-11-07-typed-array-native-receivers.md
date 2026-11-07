# Typed array calls require native methods

Typed array calls infer the native method's return and callback types. Imported
JavaScript can install an own method with an unrelated signature and return
value. Ignoring it disagrees with JavaScript; dispatching it while retaining
native return-type optimizations is also unsound.

Typed calls now check their receiver before argument evaluation and explicitly
refuse an own override. Checked JavaScript retains own-method dispatch. Authors
who need those overrides can perform the call in that domain. An argument may
still replace a native method after lookup: the already selected native method
runs, matching JavaScript.

Unifying every call through dynamic dispatch would also require tracking dynamic
return types through native type inference. We retain native typing with one
receiver boundary until that representation exists. Ordinary array properties
and checked JavaScript overrides keep their existing behavior.
