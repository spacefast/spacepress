import { Link, type LayoutProps } from "first/app";
import "./site.css";

export const metadata = { title: { default: "Garden", template: "%s · Garden" }, description: "A small plant guide." };

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="masthead"><Link href="/">Garden</Link></header>
      <main>{children}</main>
    </div>
  );
}
