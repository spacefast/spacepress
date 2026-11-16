import type { LayoutProps } from "first/app";

export const guard = "subscriber";

export default function Account({ children }: LayoutProps) {
  return <section className="account">{children}</section>;
}
