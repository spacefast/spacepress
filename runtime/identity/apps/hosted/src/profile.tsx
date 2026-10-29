import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import * as z from "zod";
import { registerPasskey } from "./passkeys.js";
import { providerLabel, useIdentity } from "./identity.js";
export function AccountProfile({ providers = [] }: { providers?: string[] }) {
  const { client, state, refresh } = useIdentity();
  const [tab, setTab] = useState("Profile");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    kind: "email" | "reverify";
    id: string;
  } | null>(null);
  const [sessions, setSessions] = useState<
    Awaited<ReturnType<typeof client.sessions>>
  >([]);
  const [mfa, setMfa] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [passkeys, setPasskeys] = useState<
    { id: string; name: string; created_at: string }[]
  >([]);
  async function run(action: () => Promise<unknown>, success = "Saved") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (tab === "Security")
      void client
        .sessions()
        .then(setSessions)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Unable to load sessions"),
        );
  }, [tab, client, state.kind]);
  if (state.kind !== "signed_in") return null;
  const { account, mfa_enabled } = state.data;
  function form(
    action: (data: FormData) => Promise<unknown>,
    children: ReactNode,
    label: string,
  ) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void run(
            () => action(data),
            label === "Send verification code" ? "Code sent" : "Saved",
          );
        }}
      >
        {children}
        <button className="primary" disabled={busy}>
          {label}
        </button>
      </form>
    );
  }
  return (
    <div className="account-layout">
      <aside>
        <div className="avatar large">
          {account.name.slice(0, 1).toUpperCase()}
        </div>
        <h2>{account.name}</h2>
        <p className="muted">Your personal account</p>
        <nav aria-label="Account settings">
          {[
            "Profile",
            "Email addresses",
            "Security",
            "Connections",
            "Organizations",
            "Privacy",
          ].map((name) => (
            <button
              key={name}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => {
                setTab(name);
                setMessage("");
                setError("");
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <button
          className="text-button"
          onClick={() => void run(() => client.signOut(), "Signed out")}
        >
          Sign out of Identity
        </button>
      </aside>
      <section className="account-content">
        <div className="eyebrow">ACCOUNT SETTINGS</div>
        <h1>{tab}</h1>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="success">
            {message}
          </div>
        )}
        {tab === "Profile" && (
          <>
            <p className="muted">
              The details you share across your applications.
            </p>
            <section className="panel">
              {form(
                (d) => client.updateProfile(String(d.get("name"))),
                <label>
                  Full name
                  <input
                    name="name"
                    defaultValue={account.name}
                    required
                    maxLength={120}
                  />
                </label>,
                "Save changes",
              )}
            </section>
            <section className="panel">
              <h3>One lasting identity</h3>
              <p>
                Your account keeps the same identity when your email changes.
                Your content and access stay with you.
              </p>
            </section>
          </>
        )}
        {tab === "Email addresses" && (
          <>
            <p className="muted">
              Sign in with any verified address. Your primary email receives
              account messages.
            </p>
            <section className="panel">
              {account.emails.map((email) => (
                <div className="list-row" key={email.id}>
                  <div>
                    <strong>{email.email}</strong>
                    <div className="muted">
                      Verified{" "}
                      {email.primary && <span className="badge">Primary</span>}
                    </div>
                  </div>
                  {!email.primary && (
                    <div className="row-actions">
                      <button
                        onClick={() =>
                          void run(() => client.primaryEmail(email.id))
                        }
                      >
                        Make primary
                      </button>
                      <button
                        onClick={() =>
                          void run(() => client.removeEmail(email.id))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {account.emails.length === 0 && (
                <p>Add and verify an email so you can recover your account.</p>
              )}
            </section>
            <section className="panel">
              <h3>Add an email</h3>
              {form(
                async (d) => {
                  const r = await client.addEmail(String(d.get("email")));
                  setPending({ kind: "email", id: r.challenge_id });
                },
                <label>
                  Email address
                  <input name="email" type="email" required />
                </label>,
                "Send verification code",
              )}
              {pending?.kind === "email" &&
                form(
                  async (d) => {
                    await client.verifyEmail(pending.id, String(d.get("code")));
                    setPending(null);
                  },
                  <label>
                    Verification code
                    <input name="code" autoComplete="one-time-code" required />
                  </label>,
                  "Verify email",
                )}
            </section>
          </>
        )}
        {tab === "Connections" && (
          <>
            <p className="muted">
              Link a sign-in provider to this account after confirming it is
              you.
            </p>
            <section className="panel">
              {account.providers.map((p) => (
                <div className="list-row" key={p.id}>
                  <strong>{p.issuer}</strong>
                  <button
                    onClick={() =>
                      void run(
                        () =>
                          client.request(
                            "providers/remove",
                            z.object({ removed: z.boolean() }),
                            { id: p.id },
                          ),
                        "Provider removed",
                      )
                    }
                  >
                    Remove connection
                  </button>
                </div>
              ))}
              {providers.map((provider) => (
                <button
                  className="provider-button"
                  key={provider}
                  onClick={() =>
                    void run(async () => {
                      const r = await client.link(provider);
                      window.location.assign(r.url);
                    })
                  }
                >
                  Link {providerLabel(provider)}
                </button>
              ))}
              {providers.length === 0 && (
                <p>
                  Your administrator has not enabled external providers yet.
                </p>
              )}
            </section>
          </>
        )}
        {tab === "Security" && (
          <>
            <p className="muted">
              Protect your account and control where you are signed in.
            </p>
            <section className="panel">
              <h3>Confirm it is you</h3>
              <p>
                Required for changes to your sign-in methods. Confirmation lasts
                five minutes.
              </p>
              <button
                onClick={() =>
                  void run(async () => {
                    const r = await client.reverifyEmail();
                    setPending({ kind: "reverify", id: r.challenge_id });
                  }, "Check your primary email")
                }
              >
                Email a confirmation code
              </button>
              {pending?.kind === "reverify" &&
                form(
                  async (d) => {
                    await client.reverify(
                      pending.id,
                      String(d.get("code")),
                      String(d.get("factor") ?? ""),
                    );
                    setPending(null);
                  },
                  <>
                    <label>
                      Email code
                      <input name="code" required />
                    </label>
                    {mfa_enabled && (
                      <label>
                        Authenticator code
                        <input name="factor" required />
                      </label>
                    )}
                  </>,
                  "Confirm",
                )}
            </section>
            <section className="panel">
              <h3>
                Authenticator app{" "}
                <span className="badge">{mfa_enabled ? "On" : "Off"}</span>
              </h3>
              <p>
                Add time-based codes and save recovery codes in a safe place.
              </p>
              {!mfa_enabled && !mfa && (
                <button
                  onClick={() =>
                    void run(async () => {
                      setMfa(
                        await client.request(
                          "mfa/setup",
                          z.object({ secret: z.string(), uri: z.string() }),
                          {},
                        ),
                      );
                    })
                  }
                >
                  Set up authenticator
                </button>
              )}
              {mfa && !mfa_enabled && (
                <>
                  <p>Enter this setup key in your authenticator:</p>
                  <code className="secret">{mfa.secret}</code>
                  {form(
                    async (d) => {
                      const r = await client.request(
                        "mfa/enable",
                        z.object({ recovery_codes: z.array(z.string()) }),
                        { code: String(d.get("code")) },
                      );
                      setCodes(r.recovery_codes);
                      setMfa(null);
                    },
                    <label>
                      Authenticator code
                      <input
                        name="code"
                        required
                        autoComplete="one-time-code"
                      />
                    </label>,
                    "Enable authenticator",
                  )}
                </>
              )}
              {mfa_enabled &&
                form(
                  (d) =>
                    client.request(
                      "mfa/remove",
                      z.object({ removed: z.boolean() }),
                      { code: String(d.get("code")) },
                    ),
                  <label>
                    Authenticator or recovery code
                    <input name="code" required />
                  </label>,
                  "Remove authenticator",
                )}
              {codes.length > 0 && (
                <div>
                  <h4>Save your recovery codes</h4>
                  <p>Each code works once. These are only shown now.</p>
                  <pre>{codes.join("\n")}</pre>
                  <button onClick={() => setCodes([])}>
                    I saved these codes
                  </button>
                </div>
              )}
            </section>
            <section className="panel">
              <h3>Passkeys</h3>
              <p>Use your fingerprint, face, or a security key to sign in.</p>
              <button
                onClick={() =>
                  void run(() => registerPasskey(client), "Passkey registered")
                }
              >
                Add a passkey
              </button>
              <button
                onClick={() =>
                  void run(
                    async () =>
                      setPasskeys(
                        await client.request(
                          "passkeys",
                          z.array(
                            z.object({
                              id: z.string(),
                              name: z.string(),
                              created_at: z.string(),
                            }),
                          ),
                        ),
                      ),
                    "Passkeys loaded",
                  )
                }
              >
                Manage passkeys
              </button>
              {passkeys.map((key) => (
                <div className="list-row" key={key.id}>
                  <span>
                    {key.name} ·{" "}
                    {new Date(
                      Number(key.created_at) * 1000,
                    ).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await client.request(
                          "passkeys/remove",
                          z.object({ removed: z.boolean() }),
                          { id: key.id },
                        );
                        setPasskeys(passkeys.filter((k) => k.id !== key.id));
                      }, "Passkey removed")
                    }
                  >
                    Remove passkey
                  </button>
                </div>
              ))}
            </section>
            <section className="panel">
              <h3>Password</h3>
              {form(
                (d) =>
                  client.request(
                    "password",
                    z.object({ updated: z.boolean() }),
                    { password: String(d.get("password")) },
                  ),
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                  />
                  <small>
                    At least 12 characters. Changing it signs out all sessions.
                  </small>
                </label>,
                "Set password",
              )}
            </section>
            <section className="panel">
              <h3>Active sessions</h3>
              {sessions.map((s) => (
                <div className="list-row" key={s.id}>
                  <div>
                    <strong>
                      {s.id === state.data.session.id
                        ? "This session"
                        : "Browser session"}
                    </strong>
                    <p className="session-label">{s.label}</p>
                    <small>
                      Expires {new Date(s.expires_at * 1000).toLocaleString()}
                    </small>
                  </div>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await client.revoke(s.id);
                        setSessions(await client.sessions());
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))}
              <button
                className="danger"
                onClick={() => void run(() => client.revokeAll())}
              >
                Sign out everywhere
              </button>
              <p className="fine-print">
                Also revokes access for connected apps. Signing out within one
                app only ends that app's session.
              </p>
            </section>
          </>
        )}
        {tab === "Organizations" && <OrganizationPanel run={run} />}
        {tab === "Privacy" && (
          <>
            <section className="panel">
              <h3>Export your account</h3>
              <p>
                Download your profile, verified emails, connections and security
                events.
              </p>
              <button
                onClick={() =>
                  void run(async () => {
                    const data = await client.request(
                      "account/export",
                      z.unknown(),
                      {},
                    );
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(data, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "account.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }, "Export downloaded")
                }
              >
                Download account data
              </button>
            </section>
            <section className="panel">
              <h3>Delete your account</h3>
              <p>
                Your account will be suspended immediately. An administrator
                completes erasure and handles content ownership.
              </p>
              {form(
                (d) =>
                  client.request(
                    "account/delete",
                    z.object({ status: z.literal("deletion_requested") }),
                    { confirmation: String(d.get("confirmation")) },
                  ),
                <label>
                  Type DELETE to request deletion
                  <input name="confirmation" required pattern="DELETE" />
                </label>,
                "Request deletion",
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
});
function OrganizationPanel({
  run,
}: {
  run: (action: () => Promise<unknown>, message?: string) => Promise<void>;
}) {
  const { client } = useIdentity();
  const [items, setItems] = useState<z.infer<typeof organizationSchema>[]>([]);
  const [invite, setInvite] = useState("");
  const load = () =>
    client.request("organizations", z.array(organizationSchema)).then(setItems);
  useEffect(() => {
    void run(load, "Organizations loaded");
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      await client.request("organizations", organizationSchema, {
        name: String(data.get("name")),
        idempotency_key: crypto.randomUUID(),
      });
      await load();
    });
  }
  return (
    <>
      <p className="muted">
        Bring people together with owner, admin and member roles.
      </p>
      <section className="panel">
        {items.map((item) => (
          <div key={item.id} className="list-row">
            <div>
              <strong>{item.name}</strong>
              <span className="badge">{item.role}</span>
              {["owner", "admin"].includes(item.role) && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    void run(async () => {
                      await client.request(
                        "organizations/invite",
                        z.object({ sent: z.boolean() }),
                        {
                          organization_id: item.id,
                          email: String(d.get("email")),
                        },
                      );
                    }, "Invitation sent");
                  }}
                >
                  <input
                    aria-label="Invite email"
                    name="email"
                    type="email"
                    required
                    placeholder="Email address"
                  />
                  <button>Invite member</button>
                </form>
              )}
            </div>
            <OrganizationMembers organization={item} run={run} />
          </div>
        ))}
      </section>
      <section className="panel">
        <h3>Create organization</h3>
        <form onSubmit={submit}>
          <label>
            Name
            <input name="name" required maxLength={120} />
          </label>
          <button>Create organization</button>
        </form>
      </section>
      <section className="panel">
        <h3>Accept invitation</h3>
        <label>
          Invitation code
          <input value={invite} onChange={(e) => setInvite(e.target.value)} />
        </label>
        <button
          onClick={() =>
            void run(async () => {
              await client.request(
                "organizations/accept",
                z.object({ joined: z.boolean() }),
                { invitation: invite },
              );
              await load();
            })
          }
        >
          Join organization
        </button>
      </section>
    </>
  );
}

const memberSchema = z.object({
  wp_user_id: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  display_name: z.string(),
});
function OrganizationMembers({
  organization,
  run,
}: {
  organization: z.infer<typeof organizationSchema>;
  run: (action: () => Promise<unknown>, message?: string) => Promise<void>;
}) {
  const { client } = useIdentity();
  const [members, setMembers] = useState<z.infer<typeof memberSchema>[]>([]);
  const load = async () =>
    setMembers(
      await client.request(
        "organizations/members?organization_id=" +
          encodeURIComponent(organization.id),
        z.array(memberSchema),
      ),
    );
  return (
    <div className="organization-members">
      <button onClick={() => void run(load, "Members loaded")}>
        View members
      </button>
      {members.map((member) => (
        <div className="list-row" key={member.wp_user_id}>
          <span>{member.display_name}</span>
          {organization.role === "owner" ? (
            <select
              aria-label={"Role for " + member.display_name}
              value={member.role}
              onChange={(e) => {
                const role = e.target.value;
                void run(async () => {
                  await client.request(
                    "organizations/role",
                    z.object({ updated: z.boolean() }),
                    {
                      organization_id: organization.id,
                      user_id: member.wp_user_id,
                      role,
                    },
                  );
                  await load();
                }, "Role updated");
              }}
            >
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          ) : (
            <span className="badge">{member.role}</span>
          )}
        </div>
      ))}
    </div>
  );
}
