import { Link, type LayoutProps } from "first/app";

export const metadata = { title: { default: "CMS", template: "%s · CMS" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site"><nav><Link href="/">Home</Link> <a href="/wp-login.php">Sign in</a></nav>{children}</div>;
}
