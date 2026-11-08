# Tested compiler compatibility

Generated from `tests/compatibility/registry.json`; run `python3 scripts/compiler-contracts.py` to update.

This is a growing evidence inventory, not an exhaustive language specification. Refusals are verified by running
`zero check --json` on each registered fixture in `tests/compiler_contracts.rs`. Supported behavior and intentional
differences link to their executable evidence. A silent, undocumented mismatch is a bug, not an exclusion.

String semantics here describe the current implementation; changes require updating the evidence and this registry.

## classes

Status: **supported**.

Named module-level classes compile inside callbacks: constructors, public fields and typed parameter properties, methods, lexical this in arrows, static members, named inheritance, super and instanceof. Private names (#field, #method, static #x, #x in value) are per declaring class: subclasses get separate slots, private state is invisible to enumeration/JSON/clone, and foreign receivers throw TypeError. Classes in imported JavaScript need no annotations and use checked values; class method values keep one identity per class. Instances share object identity; JSON and clone boundaries expose only own fields and drop class identity. See config-api.md for initialization, inference and refusal limits.

[Evidence](../tests/compiler_contracts.rs) (`classes_match_node_through_generated_php_and_wire_client_types`)

## class-metaprogramming

Status: **refused**. Diagnostic: `Z1101`.

Use concrete named classes with public fields and methods. See config-api.md for the supported surface.

[Evidence](../tests/fixtures/reject-class)

## uninstalled-package

Status: **refused**. Diagnostic: `Z1102`.

Install the package with your package manager. Zero reads supported local TypeScript/ESM sources; it does not install packages or execute JavaScript.

[Evidence](../tests/fixtures/reject-uninstalled-package)

## installed-source-packages

Status: **supported**.

Locally installed source packages resolve through nearest node_modules: exact exports with import/default conditions, module entries, and supported main/index entries. Scoped packages and exact exported subpaths are supported. Static CommonJS runs once at build time: top-level `require("<literal>")` of relative files and CommonJS packages (require/default conditions), `module.exports = …` and `exports.name = …`, with named exports for ESM importers found like Node's cjs-module-lexer. Dynamic require, require inside functions, require of ES modules, require cycles, writes to module or exports inside functions, other module properties, implicit sloppy arguments, Node built-ins other than node:crypto, export patterns, package aliases, declaration-only entries and package-target escapes are refused. Raw JavaScript uses checked runtime operations; TypeScript keeps static checking. Resolving a package does not establish compatibility with its host APIs or every export. Pinned npm probes compare selected real imports to Node.

[Evidence](../src/loader.rs) (`installed_sources_follow_nearest_packages_exact_exports_and_relative_ts_imports`)

## unannotated-javascript

Status: **supported**.

Raw .js/.mjs/.cjs functions compile supported property access, calls, mutations and coercions through checked PHP dispatch. Missing values preserve undefined identity, invalid methods and null receivers throw TypeError, and TypeScript unknown still requires refinement. This supplies no Node/browser APIs, arbitrary prototypes, accessors, sparse arrays or custom iterators. The pinned npm matrix separately qualifies selected original library algorithms and combinations.

[Evidence](../tests/compiler_contracts.rs) (`unannotated_javascript_uses_checked_value_operations_without_weakening_typescript_unknown`)

## erased-package-typescript

Status: **supported**.

TypeScript sources installed under node_modules compile like JavaScript: annotations, type declarations, type-only imports and re-exports, generics, overload and abstract signatures, `this` parameters, assertion signatures and type assertions are erased, not modelled. Runtime constructs keep the checked-JavaScript subset and its refusals; enums, namespaces, parameter properties and decorators are not erased. Values crossing into authored code are JavaScript values that need refinement, and authored code can't name a package type until declaration hydration lands.

[Evidence](../tests/compiler_contracts.rs) (`installed_package_typescript_is_type_erased_like_javascript_and_matches_node`)

## bitwise-operators

Status: **supported**.

`&`, `|`, `^`, `~`, `<<`, `>>`, `>>>` and their compound assignments compile in typed code, imported JavaScript and configuration evaluation. Operands go through ToNumber, then ToInt32 (ToUint32 for the left side of `>>>`); shift counts use ToUint32 masked to five bits, so negative counts and counts of 32 or more wrap as in JavaScript. Results are signed 32-bit integers, except `>>>`, which is unsigned. NaN, the infinities and -0 become 0. Typed code requires number operands; imported JavaScript coerces strings, booleans, null, undefined and objects through their primitive value.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## in-operator

Status: **supported**.

`key in object` compiles in typed code, imported JavaScript and configuration evaluation. The key goes through ToPropertyKey after the key expression runs; own properties are checked first, then the value's fixed prototype chain: class methods and statics, the built-in prototype of arrays, arguments, functions, errors, regexes, Map, Set, Date and Math, then Object.prototype. Arrays are dense, so an index is present exactly when it is below the length. A primitive right side throws JavaScript's TypeError. `"key" in x` narrows object unions like TypeScript; members with an optional key stay on both branches, and `unknown` narrows to an object whose key reads stay checked. Configuration evaluation inspects plain objects, arrays and arguments, and refuses a primitive right side at build time.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## delete-operator

Status: **supported**.

`delete obj.key`, `delete obj[key]` and `delete obj?.key` compile in typed code, imported JavaScript and configuration evaluation with strict-mode semantics. They return true, also for absent and inherited properties, and remove own object keys without reordering the rest. Non-configurable properties (array and string length, string indexes, regex lastIndex, class and function prototype, arguments callee, Math constants) throw JavaScript's TypeError; null and undefined receivers throw TypeError. Typed code may delete only optional properties and map entries, as TypeScript requires, so later reads stay sound; a property the closed type lacks is a missing-field error.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## delete-required-property

Status: **refused**. Diagnostic: `Z4001`.

TypeScript allows `delete` only on optional properties. Declare the property optional (`key?: T`) or build a new object without it.

[Evidence](../tests/fixtures/reject-delete-required)

## delete-array-element

Status: **refused**. Diagnostic: `Z4001`.

Zero arrays are dense, and deleting an element leaves a hole that keeps the length. Use `splice(index, 1)` to remove it, or assign `undefined` to keep the length. Imported JavaScript throws RangeError at runtime instead.

[Evidence](../tests/fixtures/reject-delete-array-element)

## do-while-and-labels

Status: **supported**.

`do…while` runs its body before the first test; `continue` goes to the test. Labeled loops, switches and blocks compile with `break label` and `continue label` in typed code, imported JavaScript and configuration evaluation, through nested loops, switches and labeled blocks. Labeled function declarations are refused, as in strict mode.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## destructuring-assignment

Status: **supported**.

Array and object patterns on the left of `=` assign existing variables, object fields and array elements, including elisions, defaults, rest elements, nested patterns and computed keys. The right side is evaluated once and is the expression's value. Each leaf runs in JavaScript order: computed key, target reference, read, default (only for undefined), write. Typed targets must accept the value, so a missing optional field needs a default or an optional target; computed keys need an open map or a literal key. Compound destructuring assignment does not exist in JavaScript.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## tagged-templates

Status: **supported**.

tag`…${x}…` calls the tag with the call site's strings array, then the substitutions, in typed code and imported JavaScript. The strings array has a `raw` property with the source text, cooked strings are undefined where an escape is invalid, each call site keeps one array across calls, and both arrays are frozen. String.raw is supported, including its object form in imported JavaScript. Configuration evaluation refuses tagged templates; call the tag inside a handler.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## bigint

Status: **supported**.

BigInt literals, the `bigint` type, BigInt(), BigInt.asIntN/asUintN, Number(b), String(b) and b.toString(radix) compile in typed code and imported JavaScript with ECMAScript semantics, in pure PHP (Zero\JsBigInt, no GMP or bcmath). Arithmetic is exact, division truncates, bitwise operators and shifts act on infinite two's complement, comparisons and loose equality compare mathematically across BigInt, number and numeric strings. Mixing BigInt and number in arithmetic, `>>>`, unary `+`, JSON serialization and Math functions throw JavaScript's TypeError; typed code refuses a static mix at the source. Configuration evaluation refuses BigInt. tests/php/bigint_test.php checks 8,800 Node-computed results.

[Evidence](../tests/compiler_contracts.rs) (`language_constructs_match_node_through_generated_php`)

## build-time-clock

Status: **refused**. Diagnostic: `Z2101`.

Use the clock in a handler or timestamp().defaultNow(). Configuration evaluation stays pure.

[Evidence](../tests/fixtures/reject-build-time-clock)

## access-database-query

Status: **refused**. Diagnostic: `Z4101`.

Return a row filter; put database effects in a hook or action.

[Evidence](../tests/fixtures/reject-access-query)

## field-ui-width

Status: **refused**. Diagnostic: `Z3101`.

Use an integer percentage from 1 to 100 for .ui({ width }).

[Evidence](../tests/fixtures/reject-field-ui)

## undefined-as-null

Status: **divergence**.

Explicit undefined preserves typeof, coercion and JSON omission in compiled PHP. Some statically typed missing reads and annotation-only undefined/void still normalize to null; raw imported JavaScript uses a distinct undefined sentinel. The differential oracle normalizes final undefined results explicitly.

[Evidence](../tests/compiler_contracts.rs) (`documented_runtime_differences_are_measured_in_evaluation_and_compiled_php`)

## unicode-codepoint-indexing

Status: **divergence**.

Configuration evaluation and compiled PHP index and slice strings in UTF-16 code units, like JS. A result that would split a surrogate pair is refused at build time or throws a RangeError at runtime, because UTF-8 cannot represent a lone surrogate. Diagnostic columns also count UTF-16 code units.

[Evidence](../tests/compiler_contracts.rs) (`documented_runtime_differences_are_measured_in_evaluation_and_compiled_php`)

## uri-encoding

Status: **supported**.

encodeURI and encodeURIComponent accept one string in configuration and handlers. Component punctuation is preserved; whole-URI delimiters are preserved only by encodeURI. Values must be valid Unicode scalar strings.

[Evidence](../tests/compiler_contracts.rs) (`uri_vectors_agree_in_node_pure_evaluation_and_generated_php`)

## field-presentation

Status: **supported**.

Field .ui() metadata survives nested schema emission and schema description and maps to native SCF. It does not affect data paths, validation or access.

[Evidence](../tests/compiler_contracts.rs) (`nested_presentation_reaches_scf_and_public_schema_without_storage_migrations`)

## finite-type-algebra

Status: **supported**.

Finite object interface inheritance and intersections, generic aliases/interfaces with constraints and defaults, finite keyof/indexed access and dynamic key reads, mapped types and selected utility/conditional types retain literal and optional boundaries. Concrete aliases also preserve class identity, typed fields/constructor parameter properties and method results while generated clients erase methods at the wire boundary. See runtime-contract.md (TypeScript type normalization) for the supported domains and refusals; the strict type-semantics fixture also checks generated-client boundaries and native/WASM parity.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## declared-type-predicates

Status: **supported**.

Synchronous concrete helpers and inline callbacks can return named-parameter type predicates. The target must be a subtype of the parameter and the body must return booleans. Calls narrow their checked argument on the true branch; filter, find and findLast narrow elements when their first callback parameter is refined. Function aliases preserve predicates; map produces booleans. As in TypeScript, the authored predicate declares the refinement; the compiler does not prove nested runtime checks. Assertions, this predicates and predicate function-type annotations are refused. Direct Boolean callbacks retain JavaScript truthiness. Required tuple destructuring positions retain their declared types; array positions may be undefined, and mutation widens tuple read views. The type-semantics fixture checks native/WASM emission and strict client types.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## finite-key-validation

Status: **refused**. Diagnostic: `Z4001`.

A finite keyof is a literal union, not string.

[Evidence](../tests/fixtures/reject-type-keyof)

## generic-constraint-validation

Status: **refused**. Diagnostic: `Z4001`.

Generic arguments must satisfy their declared structural constraints.

[Evidence](../tests/fixtures/reject-type-constraint)

## generic-required-argument

Status: **refused**. Diagnostic: `Z4001`.

Provide every required argument; missing arguments never widen to unknown.

[Evidence](../tests/fixtures/reject-type-arity)

## indexed-union-missing-key

Status: **refused**. Diagnostic: `Z4001`.

An indexed key must exist in every member of an object union.

[Evidence](../tests/fixtures/reject-type-index)

## open-keyof

Status: **refused**. Diagnostic: `Z4001`.

Use an explicit string key type for open maps. Array/prototype and symbol key spaces are not modeled.

[Evidence](../tests/fixtures/reject-type-open-keyof)

## recursive-type-expansion

Status: **refused**. Diagnostic: `Z4001`.

Recursive types are refused by bounded expansion; type operations also have a step and finite-key budget.

[Evidence](../tests/fixtures/reject-type-recursion)

## runtime-generic-functions

Status: **refused**. Diagnostic: `Z4001`.

Use generic aliases with concrete PHP-reachable function signatures. There is no generic runtime specialization.

[Evidence](../tests/fixtures/reject-type-runtime-generic)

## finite-record-presence

Status: **refused**. Diagnostic: `Z4001`.

Record with finite string keys requires every declared key; it is not an open string map.

[Evidence](../tests/fixtures/reject-type-record-keys)

## boxed-structural-conditional

Status: **refused**. Diagnostic: `Z4001`.

Conditional matching of primitive/array prototype properties is refused; use concrete scalar, array or finite object comparisons.

[Evidence](../tests/fixtures/reject-type-structural-predicate)

## type-declaration-merging

Status: **refused**. Diagnostic: `Z4001`.

Combine interface declarations explicitly or use interface extends. Repeated declarations never silently replace earlier fields.

[Evidence](../tests/fixtures/reject-type-merging)

## conditional-check-provenance

Status: **refused**. Diagnostic: `Z4001`.

Use direct type parameters for distributive checks, or tuple-wrap alias/type-operation checks to make non-distributivity explicit. Alias reduction can otherwise change TypeScript distributivity before instantiation.

[Evidence](../tests/fixtures/reject-type-conditional-alias)

## mapped-key-provenance

Status: **refused**. Diagnostic: `Z4001`.

Use direct keyof T, a direct key parameter constrained by keyof T, or literal key domains. Aliased or reduced mapped key expressions (including Keys<T>, Identity<K> and keyof T | never) are refused before shape emission because reduction can change optional presence. Aliased or reduced key-parameter constraints are also refused.

[Evidence](../tests/fixtures/reject-type-mapped-provenance)

## scalar-typeof-guards

Status: **supported**.

Equality and inequality comparisons of typeof with number, string or boolean narrow unknown values and known scalar unions, including reversed operand order, property paths, conjunctions and early returns. False branches remove matching known union members; the complement of unknown remains unknown. Object, function, symbol, bigint and undefined guard domains are not added. The type-semantics fixture checks identical native/WASM output and strict generated-client types.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## numeric-finiteness

Status: **supported**.

Global isFinite accepts zero or one argument and applies numeric coercion; Number.isFinite checks numbers without coercion. Number.isFinite is available as a stable function value, including local and captured aliases and feature detection. The differential numeric owner compares NaN, infinities, numbers, strings, null, booleans and arrays in pure configuration evaluation and PHP. Missing reads, built-in results and explicit undefined preserve their identity separately from null.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## builtin-overloads

Status: **supported**.

src/builtins.rs owns JavaScript built-in overloads, arity and phase support. Unsupported arguments are refused at the call site; runtime-only dynamic receivers throw a TypeError. Captured and runtime vectors compare UTF-16 ordering, replacement substitution, ECMAScript whitespace, modulo radix conversion and signed-zero rounding to Node. Positioned includes/startsWith/endsWith are refused in typed code and configuration evaluation; checked imported JavaScript implements those positions. Callback thisArg and nondecimal numeric toString are refused. Object.freeze is refused because freezing is not modeled. JSON parsing/serialization and Error construction are runtime-only; configuration evaluation refuses them. Custom object and function coercion are refused during configuration evaluation; handlers use the checked runtime conversion path. parseInt supports correctly rounded large values in base 10 and power-of-two bases; other radices require safe integer results. Database builders, configuration/schema factories and column modifiers share the source arity contract. Build-time function-coercion refusals include extracted methods; typed replacement callbacks preserve undefined captures and receive named groups. Captured explicit undefined remains distinct from null in both language modes. Dynamic method values use the shared built-in contract. Unknown built-in properties are refused during configuration evaluation. Powers accept safe integer results, integral binary scaling, squares, square roots and IEEE special values; other powers are refused at source or explicitly at runtime. Prototype setter literals are refused; computed __proto__ data properties remain supported. Extracted method calls are refused during configuration evaluation. Database writes require static collection references. Configuration for-of and destructuring use live iterators. Addition uses default primitive conversion. Sorting keeps undefined last and excludes it from comparators. JSON schemas must accept serialized values, and custom toJSON callbacks are refused. Typed Dates require explicit toISOString/toJSON before JSON.stringify or action returns. Imported JavaScript for-of uses live iterators. Ignore-case regexes require literal ASCII source and ASCII input in both modes; non-ASCII folding and encoded character escapes are refused. RegExp source and string conversion escape delimiters and line terminators. Regex split on astral text requires the u flag. Astral pattern literals and surrogate escapes also require u, even for ASCII/BMP subjects. Lone surrogate escapes in classes are refused; valid surrogate pairs and braced scalar escapes remain supported in Unicode mode. Typed invalid-Date toJSON returns null. Generated undefined defaults become null at the storage boundary. Object overwrites preserve key order. Stored JSON defaults omit undefined object properties and normalize undefined array slots to null. Numeric string conversion uses ECMAScript shortest ties-to-even formatting. Nullish narrowing retains undefined. Cyclic array string conversion omits recursive visits. Dynamic array/arguments prototype writes are refused. Typed Date string coercion requires explicit formatting. Function call/apply property values use the function contract; unmodeled function metadata/bind reads and function string conversion are refused. Optional Error/RegExp reads preserve undefined. Date construction runs default-hint object coercion. Typed Date addition/concat requires explicit formatting. Typed and imported Dates share JsDate identity and numeric primitive conversion; timestamp/date storage and filters convert explicitly. Date JSON schemas must describe their serialized text/null form. Non-ISO Date syntax receives a source diagnostic for literals and an explicit runtime refusal for computed values. Default sorting of multiple object values requires an explicit comparator; singleton sorting does not coerce. Negative-zero expanded Date years are refused. Custom sorting accepts only a numeric difference between the two parameters or matching property paths, with finite primitive keys. Other comparator shapes and cross-family borrowed methods are refused. Unary minus performs ToNumber, and parsed JSON retains negative zero. Missing indexed and optional-property logical assignment operands retain undefined in runtime narrowing and serialized client types. Regex source escaping uses explicit UTF-8 regardless of ambient PHP multibyte settings. Configuration refuses extracted built-in method values, including identity comparisons; direct and computed receiver calls remain supported. JSON negative-zero preservation leaves exponent signs intact. Non-Unicode regex classes support digit/underscore control escapes. Runtime hasIndices and unicodeSets are false because d/v flags are refused. Runtime Error messages are own nonenumerable properties only when a defined message is supplied; name is inherited. Configuration refuses restricted arguments access instead of fabricating native Error descriptors. Error stack metadata is refused. Captured arrays and objects retain one identity across typed and imported JavaScript. Capturing lookbehind is refused because JavaScript matches captures backward. Quantified noncapturing groups require a provably nonempty body; nullable groups are refused because regex engines choose different empty iterations. JavaScript-invalid regex literals receive syntax diagnostics before lowering. Runtime constructors refuse unsupported quantifier chains. Legacy class identity escapes preserve subsequent members. Undefined becomes null at schema-shaped storage boundaries, while required fields still reject null. Unicode regex property escapes are refused because PCRE and JavaScript use different Unicode databases; use explicit character classes. Character-class escapes next to unescaped hyphens are refused; escape literal hyphens. Date strings accept ISO syntax without space/compact-offset extensions, and time requires a complete date. Typed flat accepts depths 0 and 1 (null selects 0; undefined defaults to 1), with depth-specific element inference; checked imported JavaScript supports computed depths. Configuration typeof classifies Math, JSON and console as objects; host-dependent process/require/globalThis/crypto detection is refused. Lexical for headers retain per-iteration bindings during configuration evaluation. Runtime closures must be created after the lexical bindings they capture are initialized; forward captures are refused instead of resolving an outer binding. Named callbacks may omit only parameters that accept undefined; null does not allow omission. Lexical reads and assignments before initialization refuse at source in configuration and handlers, including for/of/in source expressions; parameter defaults cannot consume a later uninitialized parameter. Error cause options are refused whether cause is own data or an inherited class method. Captured closures use closure-object identity rather than function syntax for helper/type/wrapper caches, preserving distinct factory environments. Reassigning a named exported binding is refused at the write, preventing stale import snapshots while retaining stable let/var export aliases. This includes export aliases and named default exports. Const object identity and default-export expression snapshots retain JavaScript behavior. Lexical declarations directly under switch cases require explicit braces; shared switch lexical environments are refused. Checked JavaScript class-method reads return one function per class and member; call/apply supply the receiver. Typed array calls require native methods: own overrides installed by JavaScript receive an explicit runtime refusal before arguments run; checked JavaScript retains override dispatch. Runtime for-in snapshots keys and skips deleted properties. For-of lexical destructuring bindings are predeclared in each iteration before defaults run; earlier initialized bindings remain available. Configuration evaluation shares the handler refusal of destructured var loops. Computed data-method calls retain their receiver and resolve the callee before arguments. Named function expressions are refused at source because their private self-binding is not modeled; use anonymous expressions or function declarations.

[Evidence](../tests/compiler_contracts.rs) (`builtin_vectors_agree_in_evaluation_generated_php_and_node`)

## locale-collation

Status: **refused**. Diagnostic: `Z4001`.

Locale collation depends on the host and cannot be reproduced deterministically. localeCompare is refused in configuration and typed handlers; checked imported JavaScript throws TypeError. Use < or > for deterministic UTF-16 ordering. No byte-order substitute is exposed under the localeCompare name.

[Evidence](../tests/fixtures/reject-locale-compare)

## optional-chains

Status: **supported**.

Optional chains support guarded property/index steps and single optional method calls. A non-optional continuation after a short-circuiting link is refused at source; guard each nullable step explicitly. Parenthesized chain boundaries retain ordinary property access and call behavior.

[Evidence](../tests/compiler_contracts.rs) (`optional_chains_refuse_unguarded_continuations_at_source`)

## parameter-default-scope

Status: **supported**.

Defaults may reference earlier parameters. Closure defaults require a function body without new bindings and cannot refer to the current/later parameter. Classes and nested function creation in defaults are refused. These source diagnostics also cover nested destructuring defaults, preserving parameter initialization and closure scope.

[Evidence](../tests/compiler_contracts.rs) (`parameter_default_scope_limits_are_located_refusals`)

## undefined-bindings

Status: **supported**.

undefined denotes the built-in missing value. Runtime bindings named undefined are refused at source, including function/class names, parameters, local declarations, imports, catch variables, loop variables and rest/destructuring bindings. Use a different local name.

[Evidence](../tests/compiler_contracts.rs) (`undefined_bindings_are_located_refusals_in_all_runtime_binding_forms`)

## wordpress-ability-unknown

Status: **refused**. Diagnostic: `Z4001`.

abilities.call from "php/wordpress" names an ability the build can type: one of the app's own (collections, actions, globals) or one locked in zero/abilities.json by `zero abilities pull --site <url>`. Any other name is refused with the closest known name; pull and commit the lock to call another plugin's ability.

[Evidence](../tests/fixtures/reject-ability-unknown)

## wordpress-ability-input

Status: **refused**. Diagnostic: `Z4001`.

An ability's input is checked against the TypeScript type generated from its input JSON Schema (enums, required properties, closed objects). WordPress validates the same schema again at run time; a mismatch the build can see never ships.

[Evidence](../tests/fixtures/reject-ability-input)

## wordpress-ability-name

Status: **refused**. Diagnostic: `Z4001`.

The ability name must be written in place so the build can type the input and result and record which abilities the app uses. Branch between literal calls when the ability depends on data.

[Evidence](../tests/fixtures/reject-ability-name)

## wordpress-ability-call

Status: **supported**.

abilities.call("vendor/name", input) compiles to Zero\Wp\Abilities\Call::run, which runs core's WP_Ability::execute() for the current WordPress user. The app's own abilities are typed from the schema without a pull; others from zero/abilities.json, which build and check read without touching the network. zero.gen.ts carries the same types for the editor.

[Evidence](../tests/compiler_contracts.rs) (`wordpress_abilities_are_typed_from_the_lock_and_the_schema`)

## wordpress-hook-unknown

Status: **refused**. Diagnostic: `Z3001`.

A wp-hooks/ file or directory is named after a hook in the pinned catalog (src/wordpress/catalog.json, generated by scripts/wordpress-catalog.py from core's docblocks). Any other name is refused with the closest catalog hook, because an untyped hook would pass PHP values the compiler cannot check.

[Evidence](../tests/fixtures/reject-wp-hook-unknown)

## wordpress-hook-filter-return

Status: **refused**. Diagnostic: `Z4001`.

A filter handler returns the filtered value: its first argument's type, from the catalog. Returning another type would hand WordPress a value its later callbacks do not expect.

[Evidence](../tests/fixtures/reject-wp-hook-filter-return)

## wordpress-hook-no-default

Status: **refused**. Diagnostic: `Z3001`.

Each wp-hooks/ file default-exports one handler and may export an integer `priority`. Other exports are refused; share code through an ordinary imported module.

[Evidence](../tests/fixtures/reject-wp-hook-no-default)

## wordpress-hook-file

Status: **refused**. Diagnostic: `Z1003`.

wp-hooks/ holds only .ts handler files (directly, or one directory deep named after the hook). Anything else is refused at its path instead of being skipped, so a handler never silently fails to register.

[Evidence](../tests/fixtures/reject-wp-hook-file)

## wordpress-hooks

Status: **supported**.

wp-hooks/<hook>.ts and wp-hooks/<hook>/*.ts handlers compile to PHP functions typed from the catalog and register with add_filter/add_action in the app plugin; one hook's files run in file-name order at priority 10 unless a file exports `priority`.

[Evidence](../tests/compiler_contracts.rs) (`wp_hooks_register_in_file_order_with_their_priorities`)

## wordpress-function-unknown

Status: **refused**. Diagnostic: `Z2001`.

"php/wordpress" exports the catalog's WordPress functions only: each is admitted when its PHP signature maps soundly (no by-reference parameters, no echoing template tags, no reliance on request globals). Anything else is refused at the import with the list of admitted functions. Template tags such as the_title echo; use their get_ form (get_the_title, once admitted) or a wp-hooks/ filter.

[Evidence](../tests/fixtures/reject-wp-function-unknown)

## wordpress-function-argument

Status: **refused**. Diagnostic: `Z4001`.

WordPress function arguments are checked against the catalog's types, from the pinned php-stubs/wordpress-stubs signatures and phpdoc, narrowed where a PHP parameter accepts several shapes (get_post takes a post id).

[Evidence](../tests/fixtures/reject-wp-function-argument)

## wordpress-functions

Status: **supported**.

Allowlisted WordPress functions compile to Zero\Wp\Functions::call(name, [args]): a direct PHP call through the value conversions. WP_Post and WP_User results become the same read-only views hook arguments are, and a WP_Error result throws an HttpError with its own status (422 when it has none).

[Evidence](../tests/compiler_contracts.rs) (`wordpress_functions_run_as_the_signed_in_user`)

## plugin-narrowed-write

Status: **refused**. Diagnostic: `Z4201`.

A plugin's capabilities are inferred from its compiled code, including writes made by helpers it passes a row to. The committed zero/plugins.lock.json is the grant: when the owner narrows an entry and the package source is unchanged, code beyond the entry is refused at the call that needs it. Remove the call or add the value to the entry.

[Evidence](../tests/fixtures/reject-plugin-write)

## plugin-static-host

Status: **refused**. Diagnostic: `Z4201`.

A fetch URL with a written https://host/ prefix (string, template or concatenation) is checked against the plugin's locked hosts at build time. A URL built at runtime is recorded as * and checked against the locked hosts on every request and redirect hop.

[Evidence](../tests/fixtures/reject-plugin-http)

## plugin-cross-import

Status: **refused**. Diagnostic: `Z1201`.

A plugin package imports its own modules, "zero" and ordinary npm packages, compiled under its own grant. It can't import the app's modules or another registered plugin's package; its compiled helpers, captured data and class state are namespaced per plugin.

[Evidence](../tests/fixtures/reject-plugin-isolation)

## host-globals

Status: **supported**.

Handlers use the standard host forms, type-checked by @types/node: the global fetch(url, { method, headers, body, redirect }) with a Response (status, statusText, ok, url, redirected, bodyUsed, headers.get/has/forEach, text(), json()), Headers and URLSearchParams; process.env.NAME and process.env["NAME"] (string | undefined); crypto.randomUUID(); and from "node:crypto" (import or a top-level const require) createHash and createHmac chains ending in digest("hex" | "base64" | "base64url"), randomBytes(n).toString(encoding), randomUUID and timingSafeEqual(Buffer.from(a), Buffer.from(b)). They lower in src/compile/host.rs onto Zero\Fetch (HTTPS-only egress policy), Zero\Env and Zero\Crypto. See config-api.md.

[Evidence](../tests/compiler_contracts.rs) (`host_globals_match_node_through_generated_php`)

## fetch-signal

Status: **refused**. Diagnostic: `Z4001`.

Every call already ends after 10 s. credentials, mode, cache and the other browser options are refused because they have no effect server-side.

[Evidence](../tests/fixtures/reject-fetch-signal)

## fetch-binary-body

Status: **refused**. Diagnostic: `Z4001`.

Send a string (JSON.stringify(value) for JSON) or URLSearchParams. Blob, FormData, ArrayBuffer and stream bodies are not available.

[Evidence](../tests/fixtures/reject-fetch-body)

## url-objects

Status: **refused**. Diagnostic: `Z4001`.

fetch() takes a URL string. Build it with encodeURIComponent and URLSearchParams.toString(). URL and Request objects are not compiled.

[Evidence](../tests/fixtures/reject-fetch-url-object)

## response-streams

Status: **refused**. Diagnostic: `Z4001`.

The body is read in full (at most 1 MiB) before fetch() resolves. Read it with text() or json(); arrayBuffer, blob, formData and clone are refused.

[Evidence](../tests/fixtures/reject-response-stream)

## process-env-dynamic

Status: **refused**. Diagnostic: `Z4001`.

Name the variable: process.env.NAME or process.env["NAME"]. Computed names, iterating process.env and writes are refused, so request input cannot choose a server variable.

[Evidence](../tests/fixtures/reject-process-env-dynamic)

## process-members

Status: **refused**. Diagnostic: `Z4001`.

Handlers run in PHP. Only process.env.NAME is supported.

[Evidence](../tests/fixtures/reject-process-member)

## env-in-handlers

Status: **refused**. Diagnostic: `Z4001`.

env("NAME") is a deferred reference inside defineConfig (webhook URLs and secrets, action signatures, upload credentials). Handlers read runtime variables with process.env.NAME.

[Evidence](../tests/fixtures/reject-env-handler)

## web-crypto-subtle

Status: **refused**. Diagnostic: `Z4001`.

SubtleCrypto needs ArrayBuffers and is not compiled. Hash and sign with createHash and createHmac from "node:crypto".

[Evidence](../tests/fixtures/reject-crypto-subtle)

## web-crypto-random-values

Status: **refused**. Diagnostic: `Z4001`.

Typed arrays are not compiled. Use randomBytes(n).toString("hex") from "node:crypto", or crypto.randomUUID().

[Evidence](../tests/fixtures/reject-crypto-random-values)

## node-crypto-members

Status: **refused**. Diagnostic: `Z2001`.

node:crypto provides createHash, createHmac, randomBytes, randomUUID and timingSafeEqual. Ciphers, keys, KDFs and streams are not compiled.

[Evidence](../tests/fixtures/reject-node-crypto-member)

## node-crypto-buffers

Status: **refused**. Diagnostic: `Z4001`.

Finish a hash in one expression with a string encoding: createHash("sha256").update(text).digest("hex"). Buffers exist only inside timingSafeEqual(Buffer.from(a), Buffer.from(b)) and Buffer.byteLength(text).

[Evidence](../tests/fixtures/reject-digest-buffer)

## timing-safe-equal-strings

Status: **refused**. Diagnostic: `Z4001`.

Pass Buffer.from(a) and Buffer.from(b). As in Node, inputs of different byte lengths throw RangeError, so check Buffer.byteLength first.

[Evidence](../tests/fixtures/reject-timing-safe-equal)

## node-builtins

Status: **refused**. Diagnostic: `Z1102`.

Handlers run in PHP. Use the global fetch, process.env.NAME and "node:crypto".

[Evidence](../tests/fixtures/reject-node-builtin)

## require

Status: **refused**. Diagnostic: `Z1102`.

Static CommonJS may require("node:crypto") (or "crypto"); it resolves through the same built-in module lookup as import. Other Node built-ins are refused whether imported or required.

[Evidence](../tests/fixtures/reject-require-module)

## zero-fetch-import

Status: **refused**. Diagnostic: `Z2001`.

fetch and crypto are the standard globals, not "zero" exports. Remove them from the import.

[Evidence](../tests/fixtures/reject-zero-fetch-import)

## build-time-namespaces

Status: **supported**.

A member chain rooted at a module-level object that holds functions (`import * as ns`, `const o = { f }`, `export default { f }`) resolves at compile time: functions compile to helpers and data to the shared captured singleton for that sub-value. Functions may carry own properties set with `f.x = v` or build-time `Object.assign(f, ...)`; they are called and their properties are read the same way. The differential cases `namespaceImport`, `namespaceLocal`, `namespaceDefault`, `functionProperties` and `functionAssign` run in Node and PHP.

[Evidence](../tests/compiler_contracts.rs) (`build_time_namespaces_resolve_members_and_refuse_whole_values`)

## namespace-value

Status: **refused**. Diagnostic: `Z4001`.

An object that holds functions has no PHP form. Call or read its members directly (`ns.fn(x)`, `ns.value`) instead of passing, storing, spreading, iterating or writing the object.

[Evidence](../tests/fixtures/reject-namespace-value)

## function-properties-value

Status: **refused**. Diagnostic: `Z4001`.

A PHP closure can't carry properties. Call the function or read its properties directly (`f(x)`, `f.prop`, `f.method(x)`) instead of using it as a value.

[Evidence](../tests/fixtures/reject-function-properties-value)
