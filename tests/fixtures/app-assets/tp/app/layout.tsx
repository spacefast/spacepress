import type { LayoutProps } from "typedpress/app";
import "./site.css";

export const metadata = { title: { default: "Assets", template: "%s · Assets" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site">{children}</div>;
}
