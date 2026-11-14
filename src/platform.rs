/// The oldest WordPress a build targets: 7.2's fifth beta. Compared in PHP's version_compare order
/// (`wp_plugins::version::at_least`), so 7.2's later betas, RCs and nightlies pass and 7.2-beta4 doesn't.
pub const WORDPRESS: &str = "7.2-beta5";
pub const PHP: &str = "8.2";
pub const MYSQL: &str = "8.0";
pub const MARIADB: &str = "10.11";
/// The SQLite Database Integration plugin: WordPress on SQLite (Playground, sites without a MySQL server).
pub const SQLITE: &str = "3.1.2";
pub const SERIES: &str = "0.3";

/// Exact platform floors; user pins may override them only without lowering a floor.
pub fn plugins(localized: bool) -> Vec<crate::wp_plugins::Plugin> {
    let mut pins = vec![
        (
            "secure-custom-fields",
            "6.9.7",
            "5b10edab948f64b84d44d81a29fd5794a2573205e0d5e7ea9538024fc93ff52c",
        ),
        (
            "action-scheduler",
            "4.2.0",
            "a360712a5adb066a0d60db76cbe2768234731cbcc363ba7dc2d51bf4559e4551",
        ),
        (
            "mcp-adapter",
            "0.7.1",
            "719d81aa1250615acfd8256f0acc8c13f1712f1ae398c3d5883c8b166024fe9b",
        ),
        (
            "two-factor",
            "0.17.0",
            "4d1b0f8e5d82e24876c2b4e86f119122e28a8dbaf76dfde495173226c3356f37",
        ),
    ];
    if localized {
        pins.push((
            "polylang",
            "3.9",
            "6a8b939d5209090e33600114f6f6dae03513688856514734118613c5147c68c2",
        ));
    }
    pins.into_iter()
        .map(|(slug, version, sha)| crate::wp_plugins::Plugin {
            slug: slug.into(),
            version: version.into(),
            sha256: Some(sha.into()),
            requires: Vec::new(),
            plugin_data: Some(crate::wp_plugins::Resource::WordPress {
                slug: format!("{slug}.{version}.zip"),
            }),
        })
        .collect()
}

pub fn requirements() -> serde_json::Value {
    let plugins: serde_json::Map<String, serde_json::Value> = plugins(true)
        .into_iter()
        .map(|p| (p.slug, serde_json::json!({"version":p.version,"sha256":p.sha256})))
        .collect();
    serde_json::json!({"wordpress":WORDPRESS,"php":PHP,"mysql":MYSQL,"mariadb":MARIADB,"sqlite":SQLITE,"plugins":plugins})
}

pub fn cache(project: &std::path::Path) -> std::path::PathBuf {
    std::env::var_os("FIRST_WP_PLUGIN_CACHE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| project.join(".first/cache/plugins"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn wordpress_floor_is_7_2_beta5_in_version_compare_order() {
        for (found, supported) in [
            ("7.2-beta5", true),
            ("7.2-beta5-65525", true),
            ("7.2-beta6", true),
            ("7.2-RC1", true),
            ("7.2-RC2-65600", true),
            ("7.2", true),
            ("7.2.1", true),
            ("7.3-alpha-61000", true),
            ("8.0", true),
            ("7.1", false),
            ("7.1.4", false),
            ("7.1.9", false),
            ("7.2-beta4", false),
            ("7.2-beta4-65000", false),
            ("7.2-alpha-64000", false),
        ] {
            assert_eq!(
                crate::wp_plugins::version::at_least(found, super::WORDPRESS),
                supported,
                "{found}"
            );
        }
    }
}
