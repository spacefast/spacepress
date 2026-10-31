import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import * as z from "zod";
import { IdentityClient, loginResultSchema } from "./client.js";
const descriptor = z.object({ id: z.string(), type: z.literal("public-key") });
const registration = z.object({
  challenge_id: z.string(),
  options: z.object({
    challenge: z.string(),
    rp: z.object({ id: z.string(), name: z.string() }),
    user: z.object({
      id: z.string(),
      name: z.string(),
      displayName: z.string(),
    }),
    pubKeyCredParams: z.array(
      z.object({ type: z.literal("public-key"), alg: z.number() }),
    ),
    timeout: z.number().optional(),
    attestation: z.literal("none"),
    excludeCredentials: z.array(descriptor),
    authenticatorSelection: z.object({
      residentKey: z.literal("required"),
      userVerification: z.literal("required"),
    }),
  }),
});
const authentication = z.object({
  challenge_id: z.string(),
  options: z.object({
    challenge: z.string(),
    rpId: z.string(),
    allowCredentials: z.array(descriptor),
    userVerification: z.literal("required"),
    timeout: z.number().optional(),
  }),
});
export async function registerPasskey(client: IdentityClient) {
  const options = await client.request("passkeys/options", registration, {});
  const credential = await startRegistration({ optionsJSON: options.options });
  return client.request(
    "passkeys/register",
    z.object({ registered: z.boolean() }),
    { challenge_id: options.challenge_id, credential },
  );
}
export async function signInWithPasskey(client: IdentityClient) {
  const options = await client.request(
    "sign-in/passkey/options",
    authentication,
    {},
  );
  const credential = await startAuthentication({
    optionsJSON: options.options,
  });
  return client.request("sign-in/passkey/verify", loginResultSchema, {
    challenge_id: options.challenge_id,
    credential,
  });
}
