//! Bundles an in-memory island: a virtual entry (plugin resolve_id/load), a JSX component read
//! from rolldown_fs::MemoryFileSystem, `react` and `react/jsx-runtime` aliased to preact,
//! `@wordpress/interactivity` left external, ESM output, minified.
use std::{borrow::Cow, path::PathBuf, sync::Arc};

use rolldown::{
  BundleFactory, BundleFactoryOptions, BundlerOptions, InputItem, IsExternal, OutputFormat,
  Platform, RawMinifyOptions, ResolveOptions, TsConfig,
};
use rolldown_common::Output;
use rolldown_fs::MemoryFileSystem;
use rolldown_plugin::{
  HookLoadArgs, HookLoadOutput, HookLoadReturn, HookResolveIdArgs, HookResolveIdOutput,
  HookResolveIdReturn, HookUsage, Plugin, PluginContext, SharedLoadPluginContext,
};
use rolldown_resolver::Resolver;

const VIRTUAL_ENTRY: &str = "virtual:island-entry";

#[derive(Debug)]
struct VirtualEntry;

impl Plugin for VirtualEntry {
  fn name(&self) -> Cow<'static, str> {
    "virtual-entry".into()
  }
  async fn resolve_id(&self, _ctx: &PluginContext, args: &HookResolveIdArgs<'_>) -> HookResolveIdReturn {
    Ok((args.specifier == VIRTUAL_ENTRY).then(|| HookResolveIdOutput::from_id(format!("\0{VIRTUAL_ENTRY}"))))
  }
  async fn load(&self, _ctx: SharedLoadPluginContext, args: &HookLoadArgs<'_>) -> HookLoadReturn {
    Ok((args.id == format!("\0{VIRTUAL_ENTRY}")).then(|| HookLoadOutput {
      code: arcstr::literal!(
        "import { store } from '@wordpress/interactivity';\n\
         import { Counter } from '/project/src/Counter.jsx';\n\
         import { render } from 'react-dom';\n\
         store('island', { mount: (el) => render(Counter({ start: 1 }), el) });\n"
      ),
      ..Default::default()
    }))
  }
  fn register_hook_usage(&self) -> HookUsage {
    HookUsage::ResolveId | HookUsage::Load
  }
}

fn memory_fs() -> MemoryFileSystem {
  let mut fs = MemoryFileSystem::default();
  let files: &[(&str, &str)] = &[
    ("/project/src/Counter.jsx",
     "import { useState } from 'react';\n\
      export function Counter({ start }) {\n  const [n, setN] = useState(start);\n  \
      return <button class=\"counter\" onClick={() => setN(n + 1)}>{n}</button>;\n}\n\
      export function unused() { return 'tree-shaken'; }\n"),
    ("/project/node_modules/preact/package.json", r#"{"name":"preact","version":"0.0.0-stub"}"#),
    ("/project/node_modules/preact/compat/index.js",
     "export function useState(v) { return [v, () => {}]; }\n\
      export function render(vnode, el) { el.textContent = String(vnode.props.children); }\n\
      export function notUsed() {}\n"),
    ("/project/node_modules/preact/jsx-runtime/index.js",
     "export function jsx(type, props) { return { type, props }; }\nexport const jsxs = jsx;\n"),
  ];
  for (path, code) in files {
    fs.add_file(std::path::Path::new(path), code);
  }
  fs
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
  let cwd = PathBuf::from("/project");
  let alias = |to: &str| vec![Some(to.to_string())];
  let resolve = ResolveOptions {
    alias: Some(vec![
      ("react/jsx-runtime".into(), alias("preact/jsx-runtime")),
      ("react-dom".into(), alias("preact/compat")),
      ("react".into(), alias("preact/compat")),
    ]),
    ..Default::default()
  };
  let options = BundlerOptions {
    input: Some(vec![InputItem { name: Some("island".into()), import: VIRTUAL_ENTRY.into() }]),
    cwd: Some(cwd.clone()),
    platform: Some(Platform::Browser),
    format: Some(OutputFormat::Esm),
    external: Some(IsExternal::from(vec!["@wordpress/interactivity".to_string()])),
    resolve: Some(resolve.clone()),
    minify: Some(RawMinifyOptions::Bool(true)),
    tsconfig: Some(TsConfig::Auto(false)),
    ..Default::default()
  };

  let mut factory = BundleFactory::new(BundleFactoryOptions {
    bundler_options: options,
    plugins: vec![Plugin::new_shared(VirtualEntry)],
    session: None,
    disable_tracing_setup: true,
  })
  .map_err(|e| anyhow::anyhow!("{e:?}"))?;

  let fs = memory_fs();
  let resolver = Arc::new(Resolver::new(fs.clone(), cwd, Platform::Browser, &TsConfig::Auto(false), resolve));
  let bundle = factory.create_bundle_with_fs(fs, resolver);
  let output = bundle.generate().await.map_err(|e| anyhow::anyhow!("{e:?}"))?;

  for w in &output.warnings {
    eprintln!("warning: {w:?}");
  }
  for asset in &output.assets {
    match asset {
      Output::Chunk(chunk) => println!("== {} ({} bytes)\n{}", chunk.filename, chunk.code.len(), chunk.code),
      Output::Asset(a) => println!("== asset {}", a.filename),
    }
  }
  Ok(())
}
