import { useState } from "react";

// The one island: a like button, counted in the browser only.
export default function Likes({ initial }: { initial: number }) {
  const [likes, setLikes] = useState(initial);
  return <button onClick={() => setLikes(likes + 1)}>♥ {likes}</button>;
}
