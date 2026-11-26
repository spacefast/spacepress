// `export *` never brings a default: this module's own default is the one an import reads.
export * from "./default-other";
export default { a: 1 };
