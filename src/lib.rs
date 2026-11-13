//! The First compiler: `first.config.ts` in, WordPress plugins out.
//!
//! The core (parse, lower, evaluate, extract, compile, migrate, client, schema.php) does no I/O of
//! its own: sources arrive through [`loader::Fs`] and the previous snapshot is a value
//! ([`pipeline`]). The `cli` feature adds the commands, which read and write the project, download
//! plugin dependencies and carry the embedded PHP runtime. [`wasm`] exports the core to a browser.

pub mod app;
mod app_plugin;
pub mod assets;
pub mod builtins;
pub mod client;
pub mod client_component;
pub mod compile;
pub mod content_page;
pub mod css;
pub mod diag;
pub mod eval;
pub mod extract;
pub mod ir;
pub mod json_schema;
pub mod kind_url;
pub mod layout;
pub mod loader;
pub mod lower;
pub mod migrate;
pub mod num;
pub mod openapi;
pub mod pages;
pub mod pipeline;
pub mod platform;
pub mod plugins;
pub mod runtime_schema;
pub mod schema;
pub mod schema_php;
pub mod services_config;
pub mod sort;
pub mod types;
pub mod uri;
pub mod value;
pub mod wasm;
pub mod wordpress;
pub mod wp_plugins;
pub mod wpml_config;

#[cfg(feature = "cli")]
pub mod cli;
#[cfg(feature = "cli")]
mod commands;
pub mod config_migrate;
#[cfg(feature = "host")]
mod emit;
#[cfg(feature = "host")]
pub mod host;
pub mod host_contract;
#[cfg(feature = "host")]
pub mod store;
// The front matter reader is part of the core: `page.md` routes parse with it in every build.
pub mod sync;
#[cfg(target_arch = "wasm32")]
mod wasm_host_fs;
#[cfg(feature = "host")]
mod runtime_files {
    include!(concat!(env!("OUT_DIR"), "/runtime_files.rs"));
}

#[cfg(feature = "cli")]
mod docs_files {
    include!(concat!(env!("OUT_DIR"), "/docs_files.rs"));
    include!(concat!(env!("OUT_DIR"), "/skills_files.rs"));
}

pub mod bundle;
#[cfg(feature = "host")]
mod zero_bundle;
