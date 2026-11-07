export type DecisionDocumentPayload = Readonly<{
  body: string;
  title: string;
}>;

export type DecisionDocumentPayloadParseResult =
  | Readonly<{ kind: "invalid-fields" }>
  | Readonly<{ kind: "invalid-shape" }>
  | Readonly<{ kind: "valid"; value: DecisionDocumentPayload }>;

/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters -- Request.json and Response.json are untrusted HTTP boundaries; these decoders establish the small Start Map wire contracts before either runtime consumes a value. */
export function parseDecisionDocumentPayload(payload: unknown): DecisionDocumentPayloadParseResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "invalid-shape" };
  }
  const title = "title" in payload ? payload.title : null;
  const body = "body" in payload ? payload.body : null;
  return typeof title === "string" && typeof body === "string"
    ? { kind: "valid", value: { title, body } }
    : { kind: "invalid-fields" };
}

export function decisionDocumentErrorMessage(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || !("error" in payload)) return null;
  const error = payload.error;
  if (error === null || typeof error !== "object" || !("message" in error)) return null;
  return typeof error.message === "string" ? error.message : null;
}
/* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters */
