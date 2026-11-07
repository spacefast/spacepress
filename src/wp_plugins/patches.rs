//! Deterministic, build-only patches to verified platform archives. The lock records the
//! upstream ZIP hash and the installed (patched) tree hash separately.
use super::{Plugin, Result, digest, invalid};
use std::path::Path;

const MCP_PIN: &str = "719d81aa1250615acfd8256f0acc8c13f1712f1ae398c3d5883c8b166024fe9b";

pub(super) fn apply(plugin: &Plugin, sha256: &str, directory: &Path) -> Result<()> {
    if plugin.slug != "mcp-adapter" || plugin.version != "0.7.1" || sha256 != MCP_PIN {
        return Ok(());
    }
    let path = directory.join("includes/Core/McpComponentRegistry.php");
    let source = std::fs::read_to_string(&path)?;
    if digest(source.as_bytes()) != "6461cabd43e8d9c03b88d2689486cf6e790d4bb47bae2fe3a6fd9da72c06d2c9" {
        return Err(invalid("MCP registry differs from the verified platform source"));
    }
    // The archive pin owns this transformation; fail closed if its structure changes.
    let patched = lazy_registry(&source)?;
    std::fs::write(path, patched)
}

fn replace_once(source: String, from: &str, to: &str) -> Result<String> {
    if source.matches(from).count() != 1 {
        return Err(invalid("MCP lazy projection patch does not match the pinned source"));
    }
    Ok(source.replacen(from, to, 1))
}

fn lazy_registry(source: &str) -> Result<String> {
    let mut source = source.to_owned();
    for (variable, kind, key) in [
        ("mcp_tool", "tool", "tool_name"),
        ("mcp_resource", "resource", "uri"),
        ("mcp_prompt", "prompt", "prompt_name"),
    ] {
        source = replace_once(
            source,
            &format!(
                "\t\tif ( ! $this->has_any_projection( ${variable}, '{kind}', ${key} ) ) {{\n\t\t\treturn false;\n\t\t}}\n\n"
            ),
            "",
        )?;
    }
    // Keep constructor signatures intact: the adapter owns this registry API. Projection
    // remains in its existing revision-aware list/call paths, never in registration.
    let start = source
        .find("\t/**\n\t * Project one component through all supported revisions.")
        .ok_or_else(|| invalid("missing MCP projection method"))?;
    let end = source[start..]
        .find("\t/**\n\t * Get a specific McpTool by tool name.")
        .ok_or_else(|| invalid("missing MCP tool lookup"))?
        + start;
    source.replace_range(start..end, "");
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_rejects_drift() {
        assert!(lazy_registry("<?php // another adapter").is_err());
    }
}
