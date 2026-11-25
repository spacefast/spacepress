import { notice } from "./notice";

export function metadata() {
  return { title: notice() };
}

export default function OptionPage() {
  return <p className="about">{notice()}</p>;
}
