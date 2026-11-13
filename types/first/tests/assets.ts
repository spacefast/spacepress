// Asset imports type as the compiler binds them (types/first/assets.d.ts).
/// <reference path="../assets.d.ts" />
import styles from "./fixtures/card.module.css";
import logo from "./fixtures/logo.svg";
import "./fixtures/site.css";

const title: string = styles.title;
const src: string = logo;
// @ts-expect-error a CSS module's classes are read-only
styles.title = "x";
export { title, src };
