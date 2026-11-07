# Require lexical bindings before runtime closure creation

PHP closure emission needs binding types when constructing capture lists.
JavaScript permits a closure to reference a lexical binding declared later in
the same scope. Resolving an outer binding with that name produces the wrong
value, even when the later local is initialized before invocation.

We reserve lexical names before compiling a block. References to an
uninitialized binding receive a source diagnostic. Authors must initialize the
binding before creating the runtime closure. Configuration evaluation retains
its existing delayed scope lookup.

Deferring closure compilation could support valid forward captures, but would
require type inference and initialization tracking across pending bodies. We
accept this smaller runtime subset to keep capture resolution explicit and
correct. The restriction can be relaxed when deferred compilation models those
bindings directly.
