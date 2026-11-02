// The provider bucket belongs to the backend; private file resources keep their existing API names.
import { env } from "zero";
export default {
  backend: "s3" as const,
  bucket: "zero-uploads",
  region: "garage",
  endpoint: env("ZERO_TEST_UPLOAD_ENDPOINT"),
  pathStyle: true,
  prefix: "test",
  credentials: { accessKeyId: env("ZERO_TEST_UPLOAD_KEY"), secretAccessKey: env("ZERO_TEST_UPLOAD_SECRET") },
};
