// The shop's sign-in page. wp-login.php renders this inside the root layout; the form still posts
// to wp-login.php, so WordPress's password check, TypedPress's sign-in protections and the second-factor
// step all apply. Lost password, reset and register keep WordPress's own screens.
import { LoginForm, type LoginProps } from "typedpress/app";

export const metadata = { title: "Sign in" };

export default function Login({ errors, messages, lostPasswordUrl }: LoginProps) {
  return (
    <section className="signin">
      <h1>Sign in</h1>
      <p className="muted">Sign in to see your orders. Staff manage the shop in TypedPress Admin.</p>
      {messages.map((m) => <p className="notice">{m}</p>)}
      {errors.length > 0 ? <p className="problem">{errors.join(" ")}</p> : null}
      <LoginForm className="signin-form" submitLabel="Sign in" notices={false} links={false} />
      <p className="muted"><a href={lostPasswordUrl}>Forgot your password?</a></p>
    </section>
  );
}
