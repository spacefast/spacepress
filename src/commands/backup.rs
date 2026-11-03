use std::process::ExitCode;

pub(crate) fn cli(args: &[String]) -> ExitCode {
    super::deploy::cli(&[vec!["backup".into()], args.to_vec()].concat())
}
