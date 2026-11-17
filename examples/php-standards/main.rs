fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let dest = std::env::args().nth(1).unwrap();
    std::fs::create_dir_all(&dest).unwrap();
    for name in ["pantry", "kitchen-sink", "blog"] {
        let project = root.join("examples").join(name);
        let program = typedpress::loader::load(&project.join("typedpress.config.ts")).unwrap();
        let built = typedpress::pipeline::build(
            &project,
            &program,
            || Ok(typedpress::pipeline::Previous::none()),
            |_| None,
        )
        .unwrap();
        std::fs::write(format!("{dest}/{name}-functions.php"), built.functions_php).unwrap();
    }
}
