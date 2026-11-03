import type { EnvValue } from "./index";

/** Native forms use the existing runtime schema validator; no JavaScript runs on submission. */
export type ServiceFormField =
  | { readonly type: "text" | "email" | "integer"; readonly notNull?: boolean; readonly rules?: { readonly min?: number; readonly max?: number } }
  | { readonly type: "boolean"; readonly notNull?: boolean };

export interface ServiceForm {
  readonly fields: Readonly<Record<string, ServiceFormField>>;
  /** Resolved by Zero\Env when the native queued mail job runs. */
  readonly recipient: EnvValue;
  readonly sender: EnvValue;
  /** Accepted intents per client address/form per 15 minutes; integer 1–100, default 5. */
  readonly limit?: number;
}

export interface ServiceProduct {
  readonly name: string;
  /** Server-owned integer minor units, 50–99,999,999. */
  readonly amount: number;
  /** Three lowercase letters. Check the provider's amount conventions for this currency. */
  readonly currency: string;
}

/** Private server config. Stripe, rate-limit and optional SMTP secrets retain their documented runtime env names. */
export type ServicesConfig = {
  readonly forms?: Readonly<Record<string, ServiceForm>>;
  /** Authored collection key → explicit text fields. Requires drafts: true; access rules still apply. */
  readonly search?: Readonly<Record<string, readonly [string, ...string[]]>>;
} & (
  | { readonly products?: never; readonly checkoutReturnUrl?: never }
  | { readonly products: Readonly<Record<string, ServiceProduct>>; readonly checkoutReturnUrl: string }
);
