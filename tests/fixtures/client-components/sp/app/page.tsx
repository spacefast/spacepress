import { LikeButton } from "../components/LikeButton";
import { Effects } from "../components/Effects";
import { Toggle } from "../components/Toggle";
import { Shelf } from "../components/Shelf";
import { Guestbook } from "../components/Guestbook";
import { Card } from "../components/Card";
import { Switch } from "../components/Switch";
import { Loops } from "../components/Loops";

export default function Home() {
  return (
    <main>
      <LikeButton postId={41} count={1} />
      <Effects step={2} />
      <Toggle />
      <Card postId={42} />
      <Switch />
      <Shelf books={[{ id: 1, title: "Dune" }, { id: 2, title: "Emma" }]} />
      <Guestbook limit={10} />
      <Loops items={[2, 5, -1]} />
    </main>
  );
}
