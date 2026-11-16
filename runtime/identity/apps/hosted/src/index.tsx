import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { IdentityClient } from "./client.js";
import {
  IdentityProvider,
  SignIn,
  AccountProfile,
  UserButton,
  useIdentity,
} from "./identity.js";
import "./style.css";
const root = document.getElementById("identity-root");
if (!root?.dataset.api) throw new Error("Identity configuration missing");
const site = root.dataset.site?.trim() || "Identity";
const client = new IdentityClient(root.dataset.api);
// The issuer's own URL, so a WordPress in a subdirectory (/blog/identity) works unchanged.
const issuerUrl = root.dataset.issuer ?? new URL("/identity", location.origin).href;
const issuerPath = new URL(issuerUrl).pathname.replace(/\/$/, "");
// The site's one sign-in page (wp-login.php), coming back here.
const loginUrl = root.dataset.login ?? "/wp-login.php";
function App() {
  const { state } = useIdentity();
  const [config, setConfig] = useState<{ providers: string[]; issuer: string }>(
    { providers: [], issuer: issuerUrl },
  );
  const [upgradeRequested, setUpgradeRequested] = useState(() =>
    new URLSearchParams(location.search).has("upgrade"),
  );
  useEffect(() => {
    void client.config().then(setConfig);
  }, []);
  function finish() {
    const params = new URLSearchParams(location.search);
    if (params.has("factor")) {
      // The second factor is done; the consumed challenge must not keep the form on screen.
      params.delete("factor");
      const rest = params.toString();
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
      setFactorPending(false);
    }
    if (params.has("reauth")) {
      location.assign(issuerPath + "/authorize?resume=1");
      return;
    }
    const target = params.get("return_to");
    if (target?.startsWith("/authorize?")) {
      location.assign(issuerPath + target);
      return;
    }
    if (params.has("upgrade")) {
      params.delete("upgrade");
      const query = params.toString();
      history.replaceState(null, "", location.pathname + (query ? "?" + query : ""));
      setUpgradeRequested(false);
    }
  }
  const reauth = new URLSearchParams(location.search).has("reauth");
  // A pending second factor (e.g. after an external provider) wins over any existing session.
  const [factor, setFactorPending] = useState(() => new URLSearchParams(location.search).has("factor"));
  const upgrade =
    upgradeRequested ||
    (state.kind === "signed_in" && state.data.account.guest);
  // Signed out (or just signed out here): sign in on the site's one sign-in page. A second factor
  // still owed after an external provider is the only sign-in step these screens keep.
  const methods = new URLSearchParams(location.search).has("methods");
  const toLogin = state.kind === "signed_out" && !factor && !upgrade && !methods;
  useEffect(() => {
    if (toLogin) location.assign(loginUrl);
  }, [toLogin]);
  return (
    <>
      <header className="site-header">
        <a className="brand" href={issuerPath}>
          <span>{site}</span>
          <span className="brand-sub">Identity</span>
        </a>
        <UserButton />
      </header>
      <main>
        {state.kind === "loading" ? (
          <p className="loading" role="status">
            Loading your account…
          </p>
        ) : state.kind === "error" ? (
          <p className="error" role="alert">
            {state.message}
          </p>
        ) : upgrade && !reauth ? (
          <div className="upgrade-layout">
            <SignIn
              providers={config.providers}
              issuer={config.issuer}
              upgrade
              onComplete={finish}
            />
          </div>
        ) : toLogin ? (
          <p className="loading" role="status">
            Taking you to sign in…
          </p>
        ) : state.kind === "signed_out" || reauth || factor ? (
          <div className="signin-layout">
            <div className="welcome">
              <span className="eyebrow">A PLACE FOR EVERYTHING YOU MAKE</span>
              <h2>
                Keep your identity.
                <br />
                Go anywhere.
              </h2>
              <p>
                One secure account for your projects, your people, and whatever
                comes next.
              </p>
              <div className="orbit">
                <i />
                <i />
                <i />
              </div>
              <p className="welcome-caption">
                Built on WordPress. Made for the open web.
              </p>
            </div>
            <SignIn
              providers={config.providers}
              issuer={config.issuer}
              onComplete={finish}
            />
          </div>
        ) : (
          <AccountProfile providers={config.providers} />
        )}
      </main>
      <footer>
        {site} <span>Your account, under your control.</span>
      </footer>
    </>
  );
}
createRoot(root).render(
  <IdentityProvider client={client} site={site}>
    <App />
  </IdentityProvider>,
);
