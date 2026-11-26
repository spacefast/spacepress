import { sources } from "../data/sources";

export function Code({ code, file, lang, note }: { code: string; file?: string; lang?: string; note?: string }) {
  return (
    <sp-code file={file} lang={lang} note={note}>
      {code}
    </sp-code>
  );
}

export function Cmd({ command }: { command: string }) {
  return (
    <sp-code className="sp-cmd-code" lang="sh">
      {command}
    </sp-code>
  );
}

export function Tree({ text }: { text: string }) {
  return <sp-tree>{text}</sp-tree>;
}

export function ProjectExplorer({ project, open }: { project: string; open?: string }) {
  const prefix = `${project}/`;
  const files = sources.filter((s) => s.path.startsWith(prefix));
  return (
    <sp-example open={open}>
      {files.map((f) => {
        const rel = f.path.slice(prefix.length);
        return (
          <sp-code key={rel} file={rel} note={f.note ?? undefined} label={f.label ?? undefined}>
            {f.text}
          </sp-code>
        );
      })}
    </sp-example>
  );
}

export interface SandboxPreset {
  label: string;
  file?: string;
  description?: string;
  output?: string;
  code: string;
}

export function Sandbox({
  title,
  presets,
  base,
  baseFile,
  eager,
  diff,
  playExample,
  defaultTab,
}: {
  title?: string;
  presets: SandboxPreset[];
  base?: string;
  baseFile?: string;
  eager?: boolean;
  diff?: boolean;
  playExample?: string;
  defaultTab?: string;
}) {
  const key = `${title ?? ""}|${presets.map((p) => p.label).join(",")}|${base ? "b" : ""}|${playExample ?? ""}`;
  return (
    <sp-sandbox
      data-key={key}
      title={title}
      eager={eager ? "" : undefined}
      diff={diff ? "" : undefined}
      play-example={playExample}
      default-tab={defaultTab}
    >
      <div className="sp-sb-defs" hidden>
        {base && <sp-base file={baseFile ?? "spacepress.config.ts"}>{base}</sp-base>}
        {presets.map((p) => (
          <sp-preset
            key={p.label}
            label={p.label}
            file={p.file ?? "spacepress.config.ts"}
            description={p.description}
            output={p.output}
          >
            {p.code}
          </sp-preset>
        ))}
      </div>
    </sp-sandbox>
  );
}
