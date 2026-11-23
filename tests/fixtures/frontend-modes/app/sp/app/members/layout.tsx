import type { LayoutProps } from "spacepress/app";

// Signed-in readers only: no page below this layout is public.
export const guard = "subscriber";

export default function Members({ children }: LayoutProps) {
  return <section className="members">{children}</section>;
}
