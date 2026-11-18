import type { LayoutProps } from "typedpress/app";

// Signed-in customers only: a signed-out visitor goes to the sign-in page and back.
export const access = "authenticated";

export default function OrdersLayout({ children }: LayoutProps) {
  return <section className="account">{children}</section>;
}
