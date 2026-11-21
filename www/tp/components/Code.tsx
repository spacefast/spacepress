import { sources } from "../data/sources";

export function Code({ code, file, lang, note }: { code: string; file?: string; lang?: string; note?: string }) {
  return (
    <tp-code file={file} lang={lang} note={note}>
      {code}
    </tp-code>
  );
}

export function Cmd({ command }: { command: string }) {
  return (
    <tp-code className="sp-cmd-code" lang="sh">
      {command}
    </tp-code>
  );
}

export function Tree({ text }: { text: string }) {
  return <tp-tree>{text}</tp-tree>;
}

export function ProjectExplorer({ project, open }: { project: string; open?: string }) {
  const prefix = `${project}/`;
  const files = sources.filter((s) => s.path.startsWith(prefix));
  return (
    <tp-example open={open}>
      {files.map((f) => {
        const rel = f.path.slice(prefix.length);
        return (
          <tp-code key={rel} file={rel} note={f.note ?? undefined} label={f.label ?? undefined}>
            {f.text}
          </tp-code>
        );
      })}
    </tp-example>
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
    <tp-sandbox
      data-key={key}
      title={title}
      eager={eager ? "" : undefined}
      diff={diff ? "" : undefined}
      play-example={playExample}
      default-tab={defaultTab}
    >
      <div className="sp-sb-defs" hidden>
        {base && <tp-base file={baseFile ?? "typedpress.config.ts"}>{base}</tp-base>}
        {presets.map((p) => (
          <tp-preset
            key={p.label}
            label={p.label}
            file={p.file ?? "typedpress.config.ts"}
            description={p.description}
            output={p.output}
          >
            {p.code}
          </tp-preset>
        ))}
      </div>
    </tp-sandbox>
  );
}
