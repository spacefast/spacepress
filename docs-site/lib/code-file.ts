// One rendering for every file the site shows: a config, a source it imports, or a file the compiler
// wrote. The whole file is shown. Lines wrap instead of scrolling, and nothing is cut. Diagnostics
// the compiler reports for the file sit inline, under the line they point at.
//
// Rendered at build time with @pierre/diffs (preloadFile), so a page ships HTML, not a highlighter.
// The colors follow the site's light and dark theme through CSS `color-scheme` (see
// styles/code-file.css).
import { preloadFile } from "@pierre/diffs/ssr";

import type { Diagnostic } from "./compiler.ts";

export interface InlineDiagnostic {
	line: number;
	code: string;
	message: string;
	help: string | null;
}

/** The diagnostics of one file, keyed to its lines. */
export function diagnosticsFor(file: string, diagnostics: Diagnostic[]): InlineDiagnostic[] {
	return diagnostics.flatMap(({ location, code, message, help }) =>
		location?.file === file ? [{ line: location.line, code, message, help }] : [],
	);
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The HTML for one file. `diagnostics` render as rows under their lines. A diagnostic whose line is
 * past the end of the file renders after the last line.
 */
export async function renderFile(name: string, contents: string, diagnostics: InlineDiagnostic[] = []): Promise<string> {
	const lines = contents.replace(/\n$/, "").split("\n").length;
	const { prerenderedHTML } = await preloadFile({
		file: { name, contents },
		options: {
			theme: { light: "pierre-light", dark: "pierre-dark" },
			themeType: "system",
			overflow: "wrap",
			disableFileHeader: false,
		},
		annotations: diagnostics.map((d, i) => ({ lineNumber: Math.min(Math.max(d.line, 1), lines), metadata: i })),
	});
	// preloadFile writes the shadow root's content. The annotation rows are slots the page fills
	// with light-DOM children, one per diagnostic, named by line.
	const slots = diagnostics
		.map((d) => {
			const line = Math.min(Math.max(d.line, 1), lines);
			return `<div slot="annotation-${line}" class="code-file-diagnostic" role="note"><span class="code-file-diagnostic-code">${escape(d.code)}</span> ${escape(d.message)}${d.help ? `<span class="code-file-diagnostic-help">${escape(d.help)}</span>` : ""}</div>`;
		})
		.join("");
	return `<diffs-container class="code-file"><template shadowrootmode="open">${prerenderedHTML}</template>${slots}</diffs-container>`;
}
