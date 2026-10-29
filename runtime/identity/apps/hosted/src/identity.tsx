import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  IdentityClient,
  IdentityError,
  type AccountState,
  loginResultSchema,
} from "./client.js";
import { signInWithPasskey } from "./passkeys.js";
import type { z } from "zod";
type AuthState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "signed_in"; data: AccountState }
  | { kind: "error"; message: string };
type Context = {
  client: IdentityClient;
  site: string;
  state: AuthState;
  refresh: () => Promise<void>;
};
const IdentityContext = createContext<Context | null>(null);
export function IdentityProvider({
  client,
  site,
  children,
}: {
  client: IdentityClient;
  site: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  const refresh = useCallback(async () => {
    try {
      setState({ kind: "signed_in", data: await client.account() });
    } catch (e) {
      setState(
        e instanceof IdentityError && e.status === 401
          ? { kind: "signed_out" }
          : {
              kind: "error",
              message:
                e instanceof Error ? e.message : "Unable to load account",
            },
      );
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <IdentityContext.Provider value={{ client, site, state, refresh }}>
      {children}
    </IdentityContext.Provider>
  );
}
export function useIdentity() {
  const context = useContext(IdentityContext);
  if (!context) throw new Error("Wrap the application in IdentityProvider.");
  return context;
}
export function providerLabel(provider: string) {
  return provider === "google"
    ? "Google"
    : provider.charAt(0).toUpperCase() + provider.slice(1);
}
export function UserButton() {
  const { client, state, refresh } = useIdentity();
  if (state.kind !== "signed_in") return null;
  return (
    <details className="user-menu">
      <summary>
        <span className="avatar">
          {state.data.account.name.slice(0, 1).toUpperCase()}
        </span>
        {state.data.account.name}
      </summary>
      <a href={`${new URL(client.baseUrl).origin}/identity/account`}>
        Manage account
      </a>
      <button onClick={() => void client.signOut().then(refresh)}>
        Sign out
      </button>
    </details>
  );
}
export function SignIn({
  providers = [],
  issuer,
  upgrade = false,
  onComplete,
}: {
  providers?: string[];
  issuer: string;
  /** Guest upgrade: email codes only; the server attaches the email to the guest. */
  upgrade?: boolean;
  onComplete?: () => void;
}) {
  const { client, site, refresh } = useIdentity();
  const [stage, setStage] = useState<
    | { kind: "email" }
    | { kind: "password" }
    | { kind: "code"; id: string }
    | { kind: "factor"; id: string }
  >(() => {
    const factor =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("factor");
    return factor ? { kind: "factor", id: factor } : { kind: "email" };
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function accept(result: z.infer<typeof loginResultSchema>) {
    if (result.kind === "mfa_required") {
      setStage({ kind: "factor", id: result.challenge_id });
    } else {
      await refresh();
      onComplete?.();
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (key: string) => String(values.get(key) ?? "");
    setBusy(true);
    setError("");
    try {
      switch (stage.kind) {
        case "email": {
          const sent = await client.email(value("email"));
          setStage({ kind: "code", id: sent.challenge_id });
          break;
        }
        case "password":
          await accept(
            await client.password(value("login"), value("password")),
          );
          break;
        case "code":
          await accept(await client.verify(stage.id, value("code")));
          break;
        case "factor":
          await accept(await client.factor(stage.id, value("code")));
          break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="signin-card">
      <div className="eyebrow">
        {upgrade ? "YOU ARE USING A GUEST ACCOUNT" : "YOUR SPACE, CONNECTED"}
      </div>
      <h1>
        {stage.kind === "code"
          ? "Check your inbox"
          : stage.kind === "factor"
            ? "One more step"
            : upgrade
              ? "Save your account"
              : `Welcome to ${site}`}
      </h1>
      <p className="muted">
        {stage.kind === "code"
          ? "Enter the six-digit code we sent you."
          : stage.kind === "factor"
            ? "Enter your authenticator or recovery code."
            : upgrade
              ? "Add your email to keep everything you made here and sign in from any device."
              : "One account. Every place you create."}
      </p>
      {!upgrade &&
        (stage.kind === "email" || stage.kind === "password") &&
        providers.map((provider) => (
          <a
            className="provider-button"
            key={provider}
            href={`${issuer}/provider/start?${new URLSearchParams({
              provider,
              ...continuation(),
            })}`}
          >
            <span>{providerLabel(provider).charAt(0)}</span> Continue with{" "}
            {providerLabel(provider)}
          </a>
        ))}
      {!upgrade &&
        providers.length > 0 &&
        (stage.kind === "email" || stage.kind === "password") && (
          <div className="divider">or</div>
        )}
      <form key={stage.kind} onSubmit={submit}>
        {stage.kind === "email" ? (
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              autoFocus
            />
          </label>
        ) : stage.kind === "password" ? (
          <>
            <label>
              Email or username
              <input name="login" autoComplete="username" required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          </>
        ) : (
          <label>
            {stage.kind === "factor"
              ? "Authenticator or recovery code"
              : "Verification code"}
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode={stage.kind === "code" ? "numeric" : "text"}
              required
              autoFocus
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Please wait…"
            : stage.kind === "email"
              ? upgrade
                ? "Send code"
                : "Continue with email"
              : "Continue"}
        </button>
      </form>
      {upgrade ? (
        stage.kind !== "email" && (
          <button
            className="text-button"
            onClick={() => {
              setError("");
              setStage({ kind: "email" });
            }}
          >
            Use a different email
          </button>
        )
      ) : (
        <>
      <button
        className="text-button"
        onClick={() => {
          setError("");
          setStage(
            stage.kind === "email" ? { kind: "password" } : { kind: "email" },
          );
        }}
      >
        {stage.kind === "email"
          ? "Use password"
          : "Use a different sign-in method"}
      </button>
      <button
        className="provider-button"
        onClick={() => {
          setBusy(true);
          void signInWithPasskey(client)
            .then(accept)
            .catch((e) =>
              setError(e instanceof Error ? e.message : "Passkey failed"),
            )
            .finally(() => setBusy(false));
        }}
      >
        Sign in with a passkey
      </button>
        </>
      )}
      <p className="fine-print">
        Your account stays yours. Secure sign-in by {site}.
      </p>
    </section>
  );
}
export { AccountProfile } from "./profile.js";

/** The pending application authorization to resume after an external provider, if any. */
function continuation(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const target = params.has("reauth")
    ? "/identity/authorize?resume=1"
    : params.get("return_to");
  return target?.startsWith("/identity/authorize?") ? { return_to: target } : {};
}
