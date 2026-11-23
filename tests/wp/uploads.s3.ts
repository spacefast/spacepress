// The provider bucket belongs to the backend; private file resources keep their existing API names.
import { env } from "spacepress";
export default {
  backend: "s3" as const,
  bucket: "spacepress-uploads",
  region: "garage",
  endpoint: env("SP_TEST_UPLOAD_ENDPOINT"),
  pathStyle: true,
  // Exercise object-key escaping through WP postmeta and SQL LIKE during cleanup.
  prefix: "test/scope_\\quoted%",
  credentials: { accessKeyId: env("SP_TEST_UPLOAD_KEY"), secretAccessKey: env("SP_TEST_UPLOAD_SECRET") },
};
