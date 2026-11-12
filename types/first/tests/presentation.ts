import { text, integer, group, type ColumnBuilder, type FieldUi } from "first";
import { seoFields } from "../../../examples/recipes/first/seo";

const presentation = { label: "Display name", help: "Shown to visitors", placeholder: "Jane", width: 50 } satisfies FieldUi;
const title = text().ui(presentation);
const preserved: ColumnBuilder<"text", string, true, false> = title;
integer().ui({ label: "Stock", help: undefined, placeholder: undefined, width: undefined }).optional();
group(seoFields()).ui({ label: "Metadata" }).optional();
// @ts-expect-error width is numeric
text().ui({ width: "50%" }).optional();
// @ts-expect-error arbitrary adapter options are not presentation metadata
text().ui({ readOnly: true }).optional();
void preserved;
