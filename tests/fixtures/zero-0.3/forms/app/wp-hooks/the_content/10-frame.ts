import type { Handler } from "php/wordpress";
const frame: Handler<"the_content"> = (content) => `<div class="frame">${content}</div>`;
export default frame;
