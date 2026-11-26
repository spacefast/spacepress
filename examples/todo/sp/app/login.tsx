import { LoginForm } from "spacepress/server/app";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <h1>Sign in to Todo</h1>
      <p>Your tasks stay private unless you share them with your team. In local dev, use <code>admin</code> / <code>spacepress-test-admin</code>.</p>
      <LoginForm />
    </main>
  );
}
