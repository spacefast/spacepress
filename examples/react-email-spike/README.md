# React Email invitation spike

From the repository root, build both compilers.

```sh
cargo build --locked
cargo build --locked --lib --no-default-features --profile wasm --target wasm32-unknown-unknown
cd examples/react-email-spike
npm ci --ignore-scripts
npm test
```

The test renders two invitations with the pinned upstream React Email package.
It checks escaped names and URLs, Outlook button markup, and the plain-text
alternative. The native and WASM compilers both reject React's production
CommonJS source at `forEachFunc.apply(this, arguments)`. The test asserts
that diagnostic so a different compiler result prompts another look.

The transport control gives upstream-rendered strings to a WASM-compiled
TypedPress action. It runs the generated PHP in the repository's WordPress test
harness, ticks Action Scheduler, and captures the two messages using the
existing mail transport hook. It compares both bodies byte for byte.

Run `npm run email:dev` to preview the organization invitation override in
`transport/emails/identity/organization-invite.tsx`. The preview reads the
example values from `Invitation.PreviewProps`.

The override uses the same TSX file in the React Email preview and the native
and WASM TypedPress builds. The test captures HTML and plain text from WordPress,
compares both with upstream React Email, and accepts the invitation using the
code from the email. It also verifies the built-in message for an app without
an override. See the [integration notes](../../docs/design-react-email.md).

A Playground smoke test installed the native-built plugins on WordPress 7.1.5
with PHP 8.3. It issued two invitations, captured their multipart email at
PHPMailer, and accepted each invitation using the code in the message. The
captured HTML and plain text matched the React Email render for both inputs
after removing React's empty text-node separators from the HTML.
