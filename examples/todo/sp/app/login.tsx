import { LoginForm } from "spacepress/app";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <h1>Sign in to Personal TODO</h1>
      <p>Tasks are private to your WordPress account. In local dev, use <code>admin</code> / <code>spacepress-test-admin</code>.</p>
      <LoginForm />
    </main>
  );
}
