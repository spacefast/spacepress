"use client";

import { SignInWithSpacefast, useAuth, useQuery } from "@spacefast/zero/client";
import { Card, EmptyState, Spinner } from "@spacefast/zero/kit";

import type { Submission } from "../shared/contact";

export default function SubmissionsPage() {
  const auth = useAuth();
  const submissions = useQuery<Submission[]>("submissions") ?? [];

  if (auth.isLoading) return <Spinner />;
  if (auth.isGuest) {
    return (
      <EmptyState
        title="Sign in to read submissions"
        description="The server only returns the inbox to signed-in users."
        action={<SignInWithSpacefast />}
      />
    );
  }
  return (
    <Card title="Inbox" subtitle="Newest first, live as they arrive.">
      {submissions.length === 0 ? (
        <EmptyState title="No submissions yet" description="Share the form and check back." />
      ) : (
        <ul class="divide-y divide-line">
          {submissions.map((entry) => (
            <li key={entry.id} class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-sm font-medium text-ink">{entry.name}</span>
                <span class="text-xs text-ink-muted">{entry.email}</span>
              </div>
              <p class="text-sm break-words text-ink-muted">{entry.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
