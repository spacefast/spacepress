import { LoginForm, type LoginProps } from "spacepress/server/app";

export const metadata = { title: "Sign in" };

export default function Login({ errors }: LoginProps) {
  return (
    <section className="signin">
      <h1>Sign in to Field Notes</h1>
      {errors.length > 0 ? <p className="problem">{errors.join(" ")}</p> : null}
      <LoginForm notices={false} />
    </section>
  );
}
