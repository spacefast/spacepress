# Refuse reassignment after a binding is exported

JavaScript imports remain connected to their exporting binding. Configuration
evaluation currently copies export values. Reassigning an exported binding can
therefore leave imports, namespace properties and re-exports with stale values.

We refuse reassignment at its source once a binding has been named as an export.
Stable let/var export aliases remain supported. Const object exports preserve
reference identity, and default-export expressions retain their value-snapshot
behavior. Authors can finish composition before exporting or use const data.

Refusing every mutable declaration also rejected unchanged function aliases in
retained npm packages. Full live bindings would preserve reassignment, but require
one representation across import forms. We accept refusing valid reassignment
programs until that model exists, while keeping stable aliases usable.
