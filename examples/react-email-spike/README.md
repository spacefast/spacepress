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

Run `npm run email:dev` to open the upstream preview for `emails/invitation.tsx`.
The preview reads sample values from `Invitation.PreviewProps`.

The first compiler diagnostic occurs before template lowering. The app source
loader also confines ordinary imports to `tp/`. The proposed app-root
`emails/` discovery needs its own compiler entry point. PHP template rendering,
the organization invitation override, and the Playground demo remain follow-up
work. See the [integration plan](../../docs/design-react-email.md).
