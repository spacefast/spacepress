import { Html } from "spacepress/server/app";
import type { ApiField } from "spacepress/server/content";

export function Fields({ fields }: { fields: ApiField[] }) {
  return (
    <ul className="fields">
      {fields.map((f) => (
        <li key={`${f.depth}-${f.name}`} className={`depth-${f.depth}`}>
          <code className="name">{f.name}</code> <span className="type">{f.type}</span>
          {f.required && <span className="required"> required</span>}
          {f.in !== "" && <span className="in"> in {f.in}</span>}
          {f.constraints.length > 0 && <span className="constraints"> {f.constraints.join(" · ")}</span>}
          <Html value={f.description} />
        </li>
      ))}
    </ul>
  );
}
