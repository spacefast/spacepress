# React Email in TypedPress

Proposed for [SF-1735](https://linear.app/a8c/issue/SF-1735/add-react-email-support-to-typedpress).

An app author should be able to write an invitation as a typed TSX component, render it with the recipient’s name and invitation URL inside an action, and pass the resulting HTML and plain text to the existing `mail.send()` API.

## 1. Establish a reference invitation

Pin the upstream `react-email` version in a test fixture. Import its Html, Body, Text and Button components, render the invitation under Node, and derive the text with upstream `toPlainText`. Keep the generated HTML and text as reference outputs. Include a recipient name containing an ampersand and angle brackets, and an invitation URL with query parameters. Check the escaped content, button markup, and readable destination in plain text. Follow the [npm compatibility fixture](../examples/npm-compat) for dependency provenance and comparison. [React Email rendering API](https://react.email/docs/utilities/render)

## 2. Prove the compiler path before choosing the public API

Hosted compilation runs in Rust or WASM and the deployed action runs in PHP. The existing JSX action rejection fixture documents a real boundary. Start with a TSX module exporting a typed invitation-rendering function and call it from a normal TypeScript action. Trace the template imports and rendering calls through the existing npm loader and TSX component compiler. Record the first unsupported import or operation, and compare generated PHP output with the upstream fixture using two different sets of runtime props. [TSX compiler decision](decisions/2026-11-08-tsx-to-php.md) · [Existing action fixture](../tests/fixtures/reject-jsx-action/typedpress.config.ts)

Prefer compiling supported upstream source. If the renderer requires a targeted compiler mapping, document the supported exports, how each maps to existing component rendering, and the upkeep when upstream changes. Choose this path only after the fixture demonstrates HTML and text parity, including Outlook-specific button markup. If neither path works on the hosted compiler, bring the concrete blocker back for a design decision before expanding compiler scope.

## 3. Send the result through the real handler

Extend the [mail action fixture](../tests/fixtures/mail-import/typedpress.config.ts) or add a sibling invitation fixture. Compile with the native and WASM entry points, execute the generated action on WordPress and capture delivery through the test transport. Assert the recipient, subject, HTML and plain-text alternative after commit. Reuse the existing mail tests for rollback and retry behavior. Unsupported template imports should produce a diagnostic at the import.

## 4. Document the proven workflow

Publish the working invitation example with its dependency setup, template, action call and supported component list. The first implementation is complete when the documented example builds on the hosted path and sends both reference bodies with runtime data. Qualify additional components with upstream fixtures as they are added.

## Playground preview

Add an invitation example to the existing [WordPress Playground blueprint](../docs-site/lib/blueprint.ts). Let the visitor edit the recipient name, trigger the compiled action, and see the resulting subject, recipient, HTML and plain text. Run one jobs tick after the action commits so the preview is available immediately.

For this example, install a Playground-only mail capture filter on `tp_mail_transport` before the default transport. Save the normalized message in the Playground instance and return true. Display the HTML in a sandboxed frame with scripts disabled and the plain text as text. Verify this first with literal HTML and text through the existing mail API, then use the React Email fixture once its compiler path works. The browser test should change the name and verify both views reflect the second send.
