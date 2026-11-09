// The platform floors every First build targets, from tests/fixtures/platform.json, which the Rust
// and PHP suites compare with src/platform.rs.
import { readFileSync } from "node:fs";
import path from "node:path";

import { repo } from "./examples.ts";

export function platformVersions(): { wordpress: string; php: string; sqlite: string } {
	return JSON.parse(readFileSync(path.join(repo, "tests/fixtures/platform.json"), "utf8"));
}
