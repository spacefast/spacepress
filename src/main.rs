//! `first` — compiles `first.config.ts` into WordPress plugins. The command line lives in `first::cli`.

fn main() -> std::process::ExitCode {
    first::cli::main()
}
