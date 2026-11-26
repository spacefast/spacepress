import type { LayoutProps } from "spacepress/app";

export const guard = "subscriber";

export default function Account({ children }: LayoutProps) {
  return <section className="account">{children}</section>;
}
