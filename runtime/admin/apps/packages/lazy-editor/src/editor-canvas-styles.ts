/**
 * The stylesheets the host feeds into the block editor's canvas iframe, as a
 * store the editor settings subscribe to. Two parts: the base sheets every
 * canvas gets (block styles, the editor's content styles), set once when the
 * editor assets load, and the theme sheet, replaced on every host theme change.
 * Each change publishes a new snapshot, so the editor re-reads the canvas
 * ground and recomputes its dark-theme class.
 */
export interface EditorCanvasStyle {
	css: string;
}

export interface EditorCanvasStyles {
	base: EditorCanvasStyle[];
	theme: EditorCanvasStyle[];
}

let snapshot: EditorCanvasStyles = { base: [], theme: [] };
const listeners = new Set< () => void >();

function publish( next: EditorCanvasStyles ): void {
	snapshot = next;
	for ( const listener of listeners ) {
		listener();
	}
}

/** The sheets every canvas gets, in order. */
export function configureEditorCanvasStyles( styles: string[] ): void {
	publish( { ...snapshot, base: styles.map( ( css ) => ( { css } ) ) } );
}

/** The sheet that follows the host's theme. */
export function setEditorCanvasThemeStyles(
	styles: EditorCanvasStyle[]
): void {
	publish( { ...snapshot, theme: styles } );
}

export function subscribeEditorCanvasStyles( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function getEditorCanvasStyles(): EditorCanvasStyles {
	return snapshot;
}
