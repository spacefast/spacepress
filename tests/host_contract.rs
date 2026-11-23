//! www/content/docs/reference/host-contract.md's generated part is `spacepress::host_contract::render_doc()`.
//! When this fails, run `SP_UPDATE_DOCS=1 cargo test --test host_contract` and commit the doc.

// Markdown-synced docs cannot contain raw HTML comments, so delimit the generated tail by its opening line.
const START: &str = "Host contract version: ";

#[test]
fn the_host_contract_doc_is_generated_from_the_code() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/www/content/docs/reference/host-contract.md"
    );
    let doc = std::fs::read_to_string(path).unwrap();
    let (head, _) = doc.split_once(START).expect("start marker");
    let expected = format!("{head}{}", spacepress::host_contract::render_doc());
    if std::env::var_os("SP_UPDATE_DOCS").is_some() {
        std::fs::write(path, &expected).unwrap();
    }
    assert!(
        doc.trim_end() == expected.trim_end(),
        "www/content/docs/reference/host-contract.md is stale: run SP_UPDATE_DOCS=1 cargo test --test host_contract"
    );
}
