import type { LayoutProps } from "spacepress/app";

export const access = "subscriber";

export default function Account({ children }: LayoutProps) {
  return <section className="account">{children}</section>;
}
