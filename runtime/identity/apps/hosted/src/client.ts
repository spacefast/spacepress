import * as z from "zod";
export const emailSchema = z.object({
  id: z.string(),
  email: z.email(),
  primary: z.boolean(),
  verified_at: z.number(),
});
export const accountSchema = z.object({
  id: z.string(),
  wp_user_id: z.number(),
  name: z.string(),
  status: z.enum(["active", "suspended", "deletion_requested", "deleted"]),
  emails: z.array(emailSchema),
  providers: z.array(z.object({ id: z.string(), issuer: z.string() })),
});
export const sessionSchema = z.object({
  id: z.string(),
  expires_at: z.number(),
  verified_at: z.number(),
});
export const accountStateSchema = z.object({
  account: accountSchema.extend({ guest: z.boolean() }),
  session: sessionSchema,
  csrf: z.string(),
  mfa_enabled: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;
export type AccountState = z.infer<typeof accountStateSchema>;
export const loginResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("signed_in") }),
  z.object({ kind: z.literal("mfa_required"), challenge_id: z.string() }),
]);
export class IdentityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export class IdentityClient {
  private csrf = "";
  constructor(readonly baseUrl: string) {}
  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Identity-CSRF": this.csrf,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new IdentityError(
        "network_error",
        e instanceof Error ? e.message : "Network request failed",
        0,
      );
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new IdentityError(
        "invalid_response",
        "Identity returned invalid JSON",
        response.status,
      );
    }
    if (!response.ok) {
      const error = errorSchema.safeParse(raw);
      throw new IdentityError(
        error.success ? error.data.error.code : "request_failed",
        error.success ? error.data.error.message : "Request failed",
        response.status,
      );
    }
    const envelope = z.object({ data: schema }).safeParse(raw);
    if (!envelope.success)
      throw new IdentityError(
        "invalid_response",
        "Identity returned an unexpected response",
        response.status,
      );
    return envelope.data.data;
  }
  async account() {
    const state = await this.request("account", accountStateSchema);
    this.csrf = state.csrf;
    return state;
  }
  config() {
    return this.request(
      "config",
      z.object({ providers: z.array(z.string()), issuer: z.string() }),
    );
  }
  password(login: string, password: string) {
    return this.request("sign-in/password", loginResultSchema, {
      login,
      password,
    });
  }
  email(email: string) {
    return this.request(
      "sign-in/email",
      z.object({ challenge_id: z.string() }),
      { email },
    );
  }
  verify(challenge_id: string, code: string) {
    return this.request("sign-in/verify", loginResultSchema, {
      challenge_id,
      code,
    });
  }
  factor(challenge_id: string, code: string) {
    return this.request("sign-in/mfa", loginResultSchema, {
      challenge_id,
      code,
    });
  }
  async signOut() {
    await this.request("sign-out", z.object({ signed_out: z.boolean() }), {});
    this.csrf = "";
  }
  updateProfile(name: string) {
    return this.request("account", accountSchema, { name }, "PATCH");
  }
  addEmail(email: string) {
    return this.request("emails", z.object({ challenge_id: z.string() }), {
      email,
    });
  }
  verifyEmail(challenge_id: string, code: string) {
    return this.request("emails/verify", z.object({ id: z.string() }), {
      challenge_id,
      code,
    });
  }
  primaryEmail(id: string) {
    return this.request("emails/primary", z.object({ updated: z.boolean() }), {
      id,
    });
  }
  removeEmail(id: string) {
    return this.request("emails/remove", z.object({ removed: z.boolean() }), {
      id,
    });
  }
  link(provider: string) {
    return this.request("providers/link", z.object({ url: z.url() }), {
      provider,
    });
  }
  sessions() {
    return this.request(
      "sessions",
      z.array(
        z.object({
          id: z.string(),
          created_at: z.number(),
          expires_at: z.number(),
          label: z.string(),
        }),
      ),
    );
  }
  revoke(id: string) {
    return this.request("sessions/revoke", z.object({ revoked: z.boolean() }), {
      id,
    });
  }
  revokeAll() {
    return this.request(
      "sessions/revoke-all",
      z.object({ revoked: z.boolean() }),
      {},
    );
  }
  reverifyEmail() {
    return this.request(
      "reverify/email",
      z.object({ challenge_id: z.string() }),
      {},
    );
  }
  reverify(challenge_id: string, code: string, factor: string) {
    return this.request(
      "reverify/verify",
      z.object({ verified: z.boolean() }),
      { challenge_id, code, factor },
    );
  }
}
