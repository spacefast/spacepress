import { home_url } from "spacepress/server/wp";

// WordPress signs visitors in and returns them here.
export const access = "authenticated";
export const metadata = { title: "Account", robots: { index: false } };

export default function Account() {
  return (
    <>
      <h1>Account</h1>
      <p>You're signed in to WordPress.</p>
      <p><a href={home_url("/wp-admin/")}>Open WordPress admin</a></p>
    </>
  );
}
