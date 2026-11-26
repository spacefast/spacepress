"use client";
import { useState } from "react";
import { useMutation } from "spacepress/react";
import { api } from "../_generated/api";

export function ClapButton({ articleId, initial }: { articleId: number; initial: number }) {
  const [count, setCount] = useState(initial);
  const clap = useMutation(api.actions.clap);

  return (
    <button
      type="button"
      disabled={clap.pending}
      onClick={async () => {
        const res = await clap.mutate({ articleId });
        setCount(res.count);
      }}
    >
      {count} {count === 1 ? "clap" : "claps"}
    </button>
  );
}
