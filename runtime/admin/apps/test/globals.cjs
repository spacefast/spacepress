// jsdom lacks a few globals the UI primitives and some @wordpress packages touch.
const { TextEncoder, TextDecoder } = require( 'node:util' );
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
if ( typeof globalThis.PointerEvent === 'undefined' && typeof globalThis.MouseEvent !== 'undefined' ) {
	globalThis.PointerEvent = class PointerEvent extends globalThis.MouseEvent {
		constructor( type, init = {} ) {
			super( type, init );
			this.pointerId = init.pointerId ?? 0;
			this.pointerType = init.pointerType ?? 'mouse';
			this.isPrimary = init.isPrimary ?? true;
			this.width = init.width ?? 1;
			this.height = init.height ?? 1;
			this.pressure = init.pressure ?? 0;
		}
	};
}
