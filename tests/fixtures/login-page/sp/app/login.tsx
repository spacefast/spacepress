import { LoginForm, type LoginProps } from "spacepress/server/app";

export const metadata = { title: "Sign in" };

export default function Login({ errors, messages, registerUrl }: LoginProps) {
  return (
    <section className="signin">
      <h1>Sign in to Field Notes</h1>
      {messages.map((m) => <p className="notice">{m}</p>)}
      {errors.length > 0 ? <p className="problem">{errors.join(" ")}</p> : null}
      <LoginForm className="signin-form" submitLabel="Sign in" notices={false} />
      {registerUrl ? <a href={registerUrl}>Create an account</a> : null}
    </section>
  );
}
