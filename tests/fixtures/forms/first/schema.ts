import { table, text } from "first";

// Anyone may add one: a browser test writes as another visitor while a form's post is in flight
// (tests/app_router.rs `forms_submit_in_place_in_the_browser`).
export const entries = table({ name: text() }, { access: { read: "anyone", create: "anyone", update: "admin", delete: "admin" } });
