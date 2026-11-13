import styles from "./page.module.css";
import compass from "./compass.svg";
import { Counter } from "../../components/Counter";

export const metadata = { title: "About" };

export default function About() {
  return (
    <section className={styles.card}>
      <h1 className={styles.title}>About</h1>
      <img src={compass} alt="A compass" width={8} height={8} />
      <Counter />
    </section>
  );
}
