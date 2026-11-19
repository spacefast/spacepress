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

## App template directory

TypedPress recognizes `emails/` at the app root, beside `typedpress.config.ts`. Each email file default-exports one typed component. Use `emails/_components/` for shared layouts. The upstream preview discovers nested templates and skips underscore-prefixed directories. [React Email CLI](https://react.email/docs/cli)

Use a documented relative path for each built-in override, following the existing [login page convention](pages.md). For example, `emails/identity/organization-invite.tsx` selects the invitation body at build time. App-specific emails such as `emails/welcome.tsx` are imported by their senders.

## Preview the template with React Email

Use the upstream preview app for authoring. Default-export the invitation from `emails/identity/organization-invite.tsx`, set `Invitation.PreviewProps` to sample recipient data, and run `email dev` from the app root. Edit the template and verify the upstream preview refreshes. The TypedPress action imports that same component and supplies the actual recipient data. [React Email CLI](https://react.email/docs/cli)

For the browser demo, investigate linking the example to the upstream preview app built with `email build`. Verify how that app can be served alongside WordPress Playground before promising an embedded preview. In Playground, exercise the compiled action, run its queued job, and capture the payload via `tp_mail_transport` for an automated comparison against the upstream HTML and plain text for identical props.

## Override built-in email bodies

After the compiler spike, start with the organization invitation. Give the message a stable template key, proposed as `identity.organization-invite`. Resolve that key to the documented override file during compilation. Define the invitation props from the existing sender: site name, identity URL, invitation code and expiry. Use synthetic values in `PreviewProps`.

Resolve the template for the current app at the point where the sender still has those structured values, before it calls `wp_mail()`. An absent override selects the existing built-in body. A discovered override supplies rendered HTML and plain text. The identity sender owns challenge creation, recipient, subject and delivery timing. Validate the default export and its prop types at build time. A template used for identity mail should render only from its supplied props, with no action effects or external requests.

Exercise the invitation flow with and without an override. Capture the actual mail, verify that both custom bodies contain the issued code and identity URL, and redeem the code through the existing flow. Once proven, apply the same pattern to verification codes and form notifications with separately typed props for each.
