import { capsule, endpoint, json, query, string, table } from "@spacefast/zero/server";

import { parseDecisionDocumentPayload } from "../shared/http-contract";
import { utf8ByteLength } from "../shared/utf8";

const MAX_DOCUMENT_BYTES = 1_500_000;
const SHARED_DOCUMENT_OWNER = "start-map-studio";

function invalidDocument(message: string) {
  return json({ error: { code: "invalid_document", message } }, { status: 400 });
}

export default capsule({
  name: "Start Map Studio",
  schema: {
    decisionDocuments: table({
      ownerId: string(),
      title: string(),
      body: string(),
    }).index("by_owner", ["ownerId"]),
  },
  queries: {
    decisionDocument: query(async (ctx) =>
      ctx.db.decisionDocuments
        .withIndex("by_owner", (range) => range.eq("ownerId", SHARED_DOCUMENT_OWNER))
        .first(),
    ),
  },
  endpoints: {
    saveDecisionDocument: endpoint(
      { method: "PUT", path: "/api/decision-document" },
      async (ctx, request) => {
        const payload = parseDecisionDocumentPayload(await request.json());
        if (payload.kind === "invalid-shape") {
          return invalidDocument("The request must contain a decision-map document.");
        }
        if (payload.kind === "invalid-fields") {
          return invalidDocument("The document title and body must be strings.");
        }
        const { body, title } = payload.value;
        const cleanTitle = title.trim().slice(0, 160);
        if (!cleanTitle) return invalidDocument("The map needs a title.");
        if (utf8ByteLength(body) > MAX_DOCUMENT_BYTES) {
          return invalidDocument("The decision map is too large to save.");
        }
        try {
          JSON.parse(body);
        } catch {
          return invalidDocument("The decision map body must be valid JSON.");
        }
        const decisionDocuments = ctx.db.decisionDocuments;
        if (!decisionDocuments) {
          return json(
            { error: { code: "database_unavailable", message: "The document table is missing." } },
            { status: 503 },
          );
        }
        const existing = await decisionDocuments
          .withIndex("by_owner", (range) => range.eq("ownerId", SHARED_DOCUMENT_OWNER))
          .first();
        if (existing) {
          await decisionDocuments.update(existing.id, { title: cleanTitle, body });
          return json({ data: { saved: true } });
        }
        await decisionDocuments.insert({
          ownerId: SHARED_DOCUMENT_OWNER,
          title: cleanTitle,
          body,
        });
        return json({ data: { saved: true } }, { status: 201 });
      },
    ),
  },
});
