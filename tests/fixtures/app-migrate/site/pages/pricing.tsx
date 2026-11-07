// Single quotes: the move to pages/pricing/page.tsx must deepen this relative import too.
import { plans } from '../shared/plans';

function Tagline(props: { text: string }) {
  return <p class="tagline">{props.text}</p>;
}

export default function Pricing() {
  return (
    <>
      <h1>Pricing</h1>
      <Tagline text="Simple, honest pricing." />
      {plans.map((plan) => (
        <section class="plan">
          <h2>{plan.name}</h2>
          <p>{plan.blurb}</p>
        </section>
      ))}
    </>
  );
}
