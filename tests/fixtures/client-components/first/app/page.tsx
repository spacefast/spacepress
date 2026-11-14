import { LikeButton } from "../components/LikeButton";
import { Effects } from "../components/Effects";
import { Toggle } from "../components/Toggle";
import { Shelf } from "../components/Shelf";
import { Guestbook } from "../components/Guestbook";

export default function Home() {
  return (
    <main>
      <LikeButton postId={41} count={1} />
      <Effects step={2} />
      <Toggle />
      <Shelf books={[{ id: 1, title: "Dune" }, { id: 2, title: "Emma" }]} />
      <Guestbook limit={10} />
    </main>
  );
}
