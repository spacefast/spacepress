import type { LayoutProps } from "first/app";

export const metadata = { title: { default: "Docs", template: "%s · Docs" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site">{children}</div>;
}
