import { text, integer, group, type ColumnBuilder, type FieldUi } from "zero";
import { seoFields } from "../../../examples/recipes/zero/seo";

const presentation = { label: "Display name", help: "Shown to visitors", placeholder: "Jane", width: 50 } satisfies FieldUi;
const title = text().notNull().ui(presentation);
const preserved: ColumnBuilder<"text", string, true, false> = title;
integer().ui({ label: "Stock", help: undefined, placeholder: undefined, width: undefined });
group({ fields: seoFields() }).ui({ label: "Metadata" });
// @ts-expect-error width is numeric
text().ui({ width: "50%" });
// @ts-expect-error arbitrary adapter options are not presentation metadata
text().ui({ readOnly: true });
void preserved;
