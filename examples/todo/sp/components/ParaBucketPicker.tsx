"use client";

import { useState } from "react";

export function ParaBucketPicker({
  buckets,
  initialCsv,
}: {
  buckets: { id: number; name: string; kind: string; color: string }[];
  initialCsv: string;
}) {
  const [csv, setCsv] = useState(initialCsv);
  const selectedTokens = csv === "" ? [] : csv.split(",");

  return (
    <div className="para-picker">
      <input type="hidden" name="paraBucketIds" value={csv} />
      <div className="para-picker__list">
        {buckets.map((bucket) => (
          <button
            key={bucket.id}
            type="button"
            className={selectedTokens.includes(String(bucket.id)) ? "para-chip para-chip--active" : "para-chip"}
            aria-pressed={selectedTokens.includes(String(bucket.id))}
            onClick={() => {
              const token = String(bucket.id);
              const parts = csv === "" ? [] : csv.split(",").filter((p) => p !== "");
              const next = parts.includes(token)
                ? parts.filter((p) => p !== token)
                : [...parts, token];
              setCsv(next.join(","));
            }}
          >
            <span className="para-chip__dot" style={{ backgroundColor: bucket.color }} aria-hidden="true" />
            <span>{bucket.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
