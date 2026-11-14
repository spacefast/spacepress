import { LikeButton } from "./LikeButton";

// A server component in a file that sorts before the client component it renders: the client
// component still compiles as one, whichever file the compiler reaches first.
export function Card({ postId }: { postId: number }) {
  return <article className="card"><LikeButton postId={postId} count={0} /></article>;
}
