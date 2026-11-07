# Refuse mutable named exports until imports have live bindings

JavaScript imports remain connected to their exporting binding. Copying a mutable
export during configuration evaluation lets a later exporter assignment leave
importers with stale values. The same issue crosses aliases, namespace imports
and re-exports.

We refuse named exports of let or var bindings at their source declaration or
export list. Authors can export const data or pure functions instead. Const object
exports preserve reference identity, and default-export expressions retain their
JavaScript value-snapshot behavior.

Representing exports as binding references would support mutable exports, but it
requires one model across named imports, namespaces and re-exports. We accept
refusing valid mutable-export programs until that model is implemented, rather
than partially updating copied values in individual import paths.
