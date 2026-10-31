import { Block } from "@spacefast/zero-blocks";
import { plans } from "./plans.ts";

/** Imports, a loop and a component, all run at build time. */
function Card(props: { title: string; children?: unknown }) {
  return (
    <section class="card">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

export default function Pricing() {
  return (
    <>
      <h1 id="pricing">Plans</h1>
      <p class="lead">
        Simple, <strong>honest</strong> pricing &amp; no surprises: 5 &lt; 6.
      </p>
      {plans.map((plan) => (
        <Card title={plan.name} key={plan.id}>
          <p>{plan.price} / month</p>
          <ul>
            {plan.perks.map((perk) => (
              <li key={perk}>{perk}</li>
            ))}
          </ul>
        </Card>
      ))}
      <figure>
        <img src="/hero.png" alt="Hero" />
        <figcaption>The hero</figcaption>
      </figure>
      <Block name="acme/testimonials" attrs={{ count: 3 }} />
    </>
  );
}
