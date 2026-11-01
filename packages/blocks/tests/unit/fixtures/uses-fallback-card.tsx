import { FallbackCard } from "./fallback-card.tsx";

export default function UsesFallbackCard() {
  return (
    <>
      <p>before</p>
      <FallbackCard when={new Date(0)} />
    </>
  );
}
