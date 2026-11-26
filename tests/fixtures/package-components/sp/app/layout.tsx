import type { LayoutProps } from "spacepress/app";
import "./site.css";

export default function Root({ children }: LayoutProps) {
  return <div className="site">{children}</div>;
}
