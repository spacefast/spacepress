// The provider bucket belongs to the backend; private file resources keep their existing API names.
import { env } from "first";
export default {
  backend: "s3" as const,
  bucket: "first-uploads",
  region: "garage",
  endpoint: env("FIRST_TEST_UPLOAD_ENDPOINT"),
  pathStyle: true,
  // Exercise object-key escaping through WP postmeta and SQL LIKE during cleanup.
  prefix: "test/scope_\\quoted%",
  credentials: { accessKeyId: env("FIRST_TEST_UPLOAD_KEY"), secretAccessKey: env("FIRST_TEST_UPLOAD_SECRET") },
};
