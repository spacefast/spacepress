import type { LayoutProps } from "typedpress/app";

export const guard = "subscriber";

export default function Account({ children }: LayoutProps) {
  return <section className="account">{children}</section>;
}
