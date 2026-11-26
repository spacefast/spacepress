import { Link } from "spacepress/server/app";

export default function Directory() {
  return <nav>
    <Link href="/office?view=todo#queue" prefetch>Office</Link>
    <Link href="/members/archive/2026" prefetch>Archive</Link>
    <Link href="/members/tools" prefetch>Tools</Link>
    <Link href="/onboarding" prefetch>Onboarding</Link>
    <Link href="/guest" prefetch>Guests</Link>
    <Link href="/notes" prefetch>Notes list</Link>
  </nav>;
}
