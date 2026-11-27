import { f, type ColumnBuilder, type FieldUi } from "spacepress";
import { seoFields } from "../../../examples/recipes/sp/seo";

const presentation = { label: "Display name", help: "Shown to visitors", placeholder: "Jane", width: 50 } satisfies FieldUi;
const title = f.text().ui(presentation);
const preserved: ColumnBuilder<"text", string, true, false> = title;
f.integer().ui({ label: "Stock", help: undefined, placeholder: undefined, width: undefined }).optional();
f.group(seoFields()).ui({ label: "Metadata" }).optional();
// @ts-expect-error width is numeric
f.text().ui({ width: "50%" }).optional();
// @ts-expect-error arbitrary adapter options are not presentation metadata
f.text().ui({ readOnly: true }).optional();
void preserved;
