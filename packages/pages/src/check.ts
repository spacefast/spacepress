/**
 * Source checks that run before any page code executes.
 *
 * The proxy in `symbolic.ts` refuses whatever reaches it at build time, but a
 * few mistakes never reach it, or reach it without a useful location: a
 * branch on request data (`item.dek ? a : b`) runs at build time and silently
 * picks one side; importing the trusted `db` would read as the build machine,
 * not the visitor. These are found here, syntactically, with the exact
 * `file:line:column`. The check is deliberately conservative: it reports
 * patterns that are always wrong in a page module, and leaves anything it
 * cannot classify to the runtime refusals.
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
    if (ts.isConditionalExpression(node) && readsRequest(node.condition, request)) {
      report(node.condition, "dynamic_region", `A condition on ${node.condition.getText(source)} would be decided once at build time.`, "Use <Show when={...}> so PHP decides per request.");
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const logical = op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken;
      if (logical && readsRequest(node.left, request)) {
        const hint = op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken
          ? "Use orElse(value, fallback) so PHP picks the fallback per request."
          : "Use <Show when={...}> so PHP decides per request.";
        report(node.left, "dynamic_region", `${node.operatorToken.getText(source)} on ${node.left.getText(source)} would be decided once at build time.`, hint);
      }
    }
    if (ts.isIfStatement(node) && readsRequest(node.expression, request)) {
      report(node.expression, "dynamic_region", `if (${node.expression.getText(source)}) would be decided once at build time.`, "Use <Show when={...}>.");
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && readsRequest(node.operand, request)) {
      report(node, "dynamic_region", `!${node.operand.getText(source)} would be decided once at build time.`, "Use <Show when={...} not>.");
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
