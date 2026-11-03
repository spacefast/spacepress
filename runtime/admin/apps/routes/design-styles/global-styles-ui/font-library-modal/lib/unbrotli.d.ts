// Type declaration to prevent TypeScript from emitting declarations for unbrotli.js
declare module './unbrotli.js' {
	const unbrotli: any;
	export default unbrotli;
}
