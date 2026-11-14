import { Link, type LayoutProps } from "first/app";

export const metadata = { title: { default: "Prebuilt", template: "%s · Prebuilt" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site"><nav><Link href="/">Home</Link> <Link href="/about">About</Link></nav>{children}</div>;
}
