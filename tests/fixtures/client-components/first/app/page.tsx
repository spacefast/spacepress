import { LikeButton } from "../components/LikeButton";
import { Effects } from "../components/Effects";

export default function Home() {
  return (
    <main>
      <LikeButton postId={41} count={1} />
      <Effects step={2} />
    </main>
  );
}
