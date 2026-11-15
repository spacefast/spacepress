import "./site.css";
import type { LayoutProps } from "first/app";

export const metadata = { title: { default: "Field Notes", template: "%s · Field Notes" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site"><header>Field Notes</header><main>{children}</main></div>;
}
