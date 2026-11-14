// Forms without JavaScript (docs/spec/rendering.md §4.2): a page whose form posts to an action,
// reads the result or the error with `useFormState`, and fills the form again after an error
// (tests/app_router.rs `forms_work_without_javascript`).
import { defineConfig } from "first";

export default defineConfig({ name: "forms" });
