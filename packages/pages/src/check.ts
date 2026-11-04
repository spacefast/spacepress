/**
 * Source checks that run before any page code executes.
 *
 * The proxy in `symbolic.ts` refuses whatever reaches it at build time, but a
 * few mistakes never reach it, or reach it without a useful location: a
 * branch on request data (`item.dek ? a : b`) runs at build time and silently
 * picks one side; importing the trusted `db` would read as the build machine,
 * not the visitor. These are found here, syntactically, with the exact
 * `file:line:column`. Control flow and JavaScript operations must be proven
 * static; aliases, helper props and primitive placeholder strings cannot be
 * classified safely by a list of request variable names. Named field reads
 * and the explicit pages helpers still receive runtime schema validation.
 */
import { readFile } from "node:fs/promises";

import ts from "typescript";

import type { PagesDiagnostic } from "./diagnostics.ts";

/** Names that are per-request values inside a page: props, the item, loader results. */
const REQUEST_ROOTS = new Set(["item", "href", "params", "content"]);

/** Browser globals have no meaning at build time and are not PHP either. */
const BROWSER_GLOBALS = new Set(["window", "document", "localStorage", "sessionStorage", "navigator", "location", "fetch"]);

/** Build-time nondeterminism would freeze one value into every request. */
const NONDETERMINISTIC = new Set(["Date.now", "Math.random", "crypto.randomUUID"]);

function loc(file: string, source: ts.SourceFile, node: ts.Node): PagesDiagnostic["loc"] {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file, line: line + 1, column: character + 1 };
}

function rootName(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
    else if (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
    else break;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/** `item.x`, `props.item.x`, a destructured prop, or a loader result: a read of request data, as far as syntax can tell. */
function readsRequest(node: ts.Expression, requestNames: ReadonlySet<string>): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return readsRequest(node.expression, requestNames);
  if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isIdentifier(node))) return false;
  const root = rootName(node);
  return root !== null && requestNames.has(root);
}

/**
 * Proxies cannot intercept truthiness, strict equality or typeof. Only accept
 * those operations when their operands are demonstrably build-time values;
 * names alone cannot track a value through destructuring, props and helpers.
 * A unique const binding is useful here only when it holds a primitive: a
 * const array or object could acquire request values through later mutation.
 */
function staticValues(source: ts.SourceFile): (node: ts.Expression) => boolean {
  const bindings = new Map<string, (ts.VariableDeclaration | null)[]>();
  const bind = (name: ts.BindingName, declaration: ts.VariableDeclaration | null): void => {
    if (ts.isIdentifier(name)) bindings.set(name.text, [...(bindings.get(name.text) ?? []), declaration]);
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name, null);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) bind(node.name, node);
    else if (ts.isParameter(node)) bind(node.name, null);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node)) && node.name !== undefined) bind(node.name, null);
    else if (ts.isImportClause(node) && node.name !== undefined) bind(node.name, null);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) bind(node.name, null);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const resolving = new Set<string>();
  const primitive = (node: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return primitive(node.expression);
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isIdentifier(node)) {
      const definitions = bindings.get(node.text);
      if (definitions === undefined) return ["undefined", "NaN", "Infinity"].includes(node.text);
      if (definitions.length !== 1 || resolving.has(node.text)) return false;
      const declaration = definitions[0];
      if (declaration === null || declaration === undefined || declaration.initializer === undefined
        || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return false;
      resolving.add(node.text);
      const result = primitive(declaration.initializer);
      resolving.delete(node.text);
      return result;
    }
    if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => primitive(span.expression));
    if (ts.isPrefixUnaryExpression(node)) {
      return node.operator !== ts.SyntaxKind.PlusPlusToken && node.operator !== ts.SyntaxKind.MinusMinusToken && primitive(node.operand);
    }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) return primitive(node.expression);
    if (ts.isConditionalExpression(node)) return primitive(node.condition) && primitive(node.whenTrue) && primitive(node.whenFalse);
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      return op < ts.SyntaxKind.FirstAssignment || op > ts.SyntaxKind.LastAssignment
        ? primitive(node.left) && primitive(node.right)
        : false;
    }
    return false;
  };
  return primitive;
}

function safeCalls(source: ts.SourceFile): (node: ts.CallExpression) => boolean {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  const localFunctions = new Set<string>();
  const bindings = new Map<string, number>();
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) bindings.set(name.text, (bindings.get(name.text) ?? 0) + 1);
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) localFunctions.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) localFunctions.add(node.name.text);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) bind(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) && node.name !== undefined) bind(node.name);
    else if (ts.isImportClause(node) && node.name !== undefined) bind(node.name);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) bind(node.name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const names = new Set(["orElse", "link", "collectionPage", "content", "count"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "@spacefast/zero-pages") continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly || clause.namedBindings === undefined) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text);
    else for (const element of clause.namedBindings.elements) {
      if (!element.isTypeOnly && names.has((element.propertyName ?? element.name).text)) named.add(element.name.text);
    }
  }
  return (node) => {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return (named.has(callee.text) && bindings.get(callee.text) === 1)
      || (callee.text === "String" && !bindings.has("String"))
      || (localFunctions.has(callee.text) && bindings.get(callee.text) === 1);
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) return true;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    if (ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)
      && bindings.get(callee.expression.text) === 1 && names.has(callee.name.text)) return true;
    if (callee.name.text === "map") {
      const callback = node.arguments[0];
      return node.arguments.length === 1 && callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));
    }
    return ["findMany", "findFirst"].includes(callee.name.text)
      && ts.isPropertyAccessExpression(callee.expression) && ts.isPropertyAccessExpression(callee.expression.expression)
      && callee.expression.expression.name.text === "query";
  };
}

/**
 * Names bound to request data in this file: destructured component/loader
 * params named like request roots, `const x = content.query...`, and the
 * parameters of `.map` callbacks over such values.
 */
function requestNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        const name = ts.isIdentifier(element.name) ? element.name.text : null;
        const property = element.propertyName !== undefined && ts.isIdentifier(element.propertyName) ? element.propertyName.text : name;
        if (name !== null && property !== null && (REQUEST_ROOTS.has(property) || names.has(property))) names.add(name);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.name)) {
      const text = node.initializer.getText(source);
      if (/\bcontent\s*\.\s*query\b/.test(text) || readsRequest(node.initializer, names)) names.add(node.name.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map"
      && readsRequest(node.expression.expression, names)) {
      const callback = node.arguments[0];
      if (callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        for (const parameter of callback.parameters) if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const root of REQUEST_ROOTS) names.add(root);
  // Two passes: a binding may be used before the declaration that marks it is visited.
  visit(source);
  visit(source);
  // Loader return values flow into the default export's props; the destructuring above catches them by name.
  return names;
}

export async function checkSource(file: string): Promise<PagesDiagnostic[]> {
  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: PagesDiagnostic[] = [];
  const request = requestNames(source);
  const isStatic = staticValues(source);
  const safeCall = safeCalls(source);
  const report = (node: ts.Node, code: PagesDiagnostic["code"], message: string, hint?: string): void => {
    const diagnostic: PagesDiagnostic = { code, severity: "error", message };
    const where = loc(file, source, node);
    if (where !== undefined) diagnostic.loc = where;
    if (hint !== undefined) diagnostic.hint = hint;
    out.push(diagnostic);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (from === "zero" && clause !== undefined && !clause.isTypeOnly && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (imported === "db" && !element.isTypeOnly) {
            report(element, "trusted_db", "Pages cannot import the trusted db: it reads as the server, not the visitor.", "Read through load({ content }) so access rules and field masks apply.");
          }
        }
      }
      if (from.startsWith("node:") || ["fs", "path", "child_process", "os"].includes(from)) {
        report(node, "browser_global", `${from} is not available to pages; a page is compiled, not run on the server.`);
      }
    }
    if (ts.isIdentifier(node) && BROWSER_GLOBALS.has(node.text) && !ts.isPropertyAccessExpression(node.parent) && !isDeclarationName(node)) {
      report(node, "browser_global", `${node.text} does not exist when a page renders; pages render in PHP per request.`, "Use an <Island> client module for browser behavior.");
    }
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.parent) === false) {
      const name = node.getText(source).replace(/\s+/g, "");
      if (NONDETERMINISTIC.has(name)) {
        report(node, "dynamic_call", `${name}() would run once at build time and freeze one value into every request.`);
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = node.expression;
      const direct = ts.isIdentifier(receiver) || ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver);
      if ((!direct && !isStatic(receiver)) || (["length", "constructor", "prototype", "__proto__"].includes(node.name.text) && !isStatic(receiver))) {
        report(node, "dynamic_operator", "A property cannot inspect a computed request value or its JavaScript wrapper at build time.", "Read named schema fields directly; use count(rows) for query row counts.");
      }
    }
    if (ts.isElementAccessExpression(node) && !isStatic(node.expression)) {
      report(node, "dynamic_operator", "An indexed read cannot inspect request placeholders at build time; read named schema fields directly.");
    }
    if (ts.isBindingElement(node) && node.initializer !== undefined) {
      const pattern = node.parent;
      const owner = pattern.parent;
      const value = ts.isVariableDeclaration(owner) || ts.isParameter(owner) ? owner.initializer : undefined;
      if (value === undefined || !isStatic(value)) {
        report(node, "dynamic_region", "A destructuring default would inspect the placeholder instead of its per-request value.", "Read the field and use orElse(field, fallback).");
      }
    }
    if (ts.isBindingElement(node)) {
      const pattern = node.parent;
      const owner = pattern.parent;
      const value = ts.isVariableDeclaration(owner) || ts.isParameter(owner) ? owner.initializer : undefined;
      const field = node.propertyName ?? node.name;
      const key = ts.isIdentifier(field) || ts.isStringLiteral(field) ? field.text : null;
      const direct = value !== undefined && (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value));
      if ((value === undefined || !isStatic(value)) && (ts.isArrayBindingPattern(pattern) || node.dotDotDotToken !== undefined
        || (value !== undefined && !direct) || key === null || ["length", "constructor", "prototype", "__proto__"].includes(key))) {
        report(node, "dynamic_operator", "Destructuring cannot inspect a computed request value or its JavaScript wrapper at build time.", "Read named schema fields directly; use count(rows) for query row counts.");
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date") {
      report(node, "dynamic_call", "new Date() would run once at build time and freeze one value into every request.", "Render a stored timestamp field instead.");
    }
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      const isLoad = ts.isFunctionDeclaration(node) && node.name?.text === "load";
      if (!isLoad && returnsJsx(node)) {
        report(node, "async_component", "Components render synchronously at build time; an async component cannot be compiled.", "Read data in load() and pass it as props.");
      }
    }
    if (ts.isAwaitExpression(node) && /\bcontent\s*\.\s*query\b/.test(node.expression.getText(source)) === false && readsRequest(node.expression, request)) {
      report(node, "dynamic_value", "Awaiting a per-request value cannot produce it at build time.");
    }
    if (ts.isConditionalExpression(node) && !isStatic(node.condition)) {
      report(node.condition, "dynamic_region", `A condition on ${node.condition.getText(source)} would be decided once at build time.`, "Use <Show when={...}> so PHP decides per request.");
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const logical = op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken;
      if (logical && !isStatic(node.left)) {
        const hint = op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken
          ? "Use orElse(value, fallback) so PHP picks the fallback per request."
          : "Use <Show when={...}> so PHP decides per request.";
        report(node.left, "dynamic_region", `${node.operatorToken.getText(source)} on ${node.left.getText(source)} would be decided once at build time.`, hint);
      }
      if (!logical && (!isStatic(node.left) || !isStatic(node.right))) {
        report(node, "dynamic_operator", `${node.operatorToken.getText(source)} cannot inspect a per-request value at build time.`, "Use <Show when={...} is={...}> or a literal build-time expression.");
      }
    }
    if (ts.isIfStatement(node) && !isStatic(node.expression)) {
      report(node.expression, "dynamic_region", `if (${node.expression.getText(source)}) would be decided once at build time.`, "Use <Show when={...}>.");
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && !isStatic(node.operand)) {
      if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
        report(node, "dynamic_region", `!${node.operand.getText(source)} would be decided once at build time.`, "Use <Show when={...} not>.");
      } else report(node, "dynamic_operator", "An operator cannot compute a per-request value at build time.");
    }
    if (ts.isTypeOfExpression(node) && !isStatic(node.expression)) {
      report(node, "dynamic_operator", "typeof would inspect the build-time placeholder instead of its per-request value.");
    }
    if ((ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node)) && !isStatic(node.expression)) {
      report(node.expression, "dynamic_region", "Control flow cannot inspect a per-request value at build time.", "Use <Show> or the query result's .map() callback.");
    }
    if (ts.isCaseClause(node) && !isStatic(node.expression)) {
      report(node.expression, "dynamic_operator", "A switch case cannot compare a per-request value at build time.", "Use <Show when={...} is={...}>.");
    }
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !isStatic(node.expression)) {
      report(node.expression, "dynamic_region", "A loop cannot iterate per-request values at build time; use the query result's .map() callback.");
    }
    if (ts.isForStatement(node) && node.condition !== undefined && !isStatic(node.condition)) {
      report(node.condition, "dynamic_region", "A loop condition must be a literal build-time expression; use .map() for per-request rows.");
    }
    if (ts.isCallExpression(node) && !safeCall(node) && !NONDETERMINISTIC.has(node.expression.getText(source).replace(/\s+/g, ""))) {
      const receiver = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression) ? node.expression.expression : undefined;
      if ((receiver !== undefined && !isStatic(receiver)) || node.arguments.some((argument) => !isStatic(argument))
        || receiver === undefined) {
        report(node, "dynamic_call", "A call cannot compute request data at build time; only the pages helpers, query methods, .map(callback) and String(value) accept it.", "Render the field directly, or use <Show>, orElse(), a template string or an island.");
      }
    }
    if (ts.isNewExpression(node) && node.arguments?.some((argument) => !isStatic(argument))) {
      report(node, "dynamic_call", "A constructor cannot compute request data at build time.");
    }
    if (ts.isTaggedTemplateExpression(node) && ts.isTemplateExpression(node.template)
      && node.template.templateSpans.some((span) => !isStatic(span.expression))) {
      report(node, "dynamic_call", "A template tag cannot compute request data at build time; use an ordinary template string.");
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "dangerouslySetInnerHTML") {
      report(node, "dynamic_attribute", "dangerouslySetInnerHTML is not supported; stored rich text renders through <RichText>.");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent)
    || ts.isBindingElement(parent) || ts.isImportSpecifier(parent) || ts.isPropertySignature(parent) || ts.isJsxAttribute(parent)) && parent.name === node;
}

function returnsJsx(node: ts.FunctionLikeDeclaration): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true;
      return;
    }
    if (child !== node && (ts.isFunctionDeclaration(child) || ts.isArrowFunction(child) || ts.isFunctionExpression(child))) return;
    ts.forEachChild(child, visit);
  };
  if (node.body !== undefined) visit(node.body);
  return found;
}
