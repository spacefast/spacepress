"use client";
// Was src/components/Likes.tsx, a React island with client:load. It renders on the server like any
// component and hydrates with the Interactivity API: useState comes from "react".
import { useState } from "react";

export function Likes({ initial }: { initial: number }) {
  const [likes, setLikes] = useState(initial);
  return <button type="button" onClick={() => setLikes(likes + 1)}>♥ {likes}</button>;
}
