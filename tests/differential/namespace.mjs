// Plain JavaScript imported by cases.ts as a namespace and as a default object of functions.
// Shaped like picomatch: functions with own properties, Object.assign, objects of helpers.
export const constants = { SEP: "/", REGEX_DOTS: /\.+/g, limits: { depth: 2 } };
export function shout(value) { return value.toUpperCase() + "!"; }
export function touch(record) { record.count = record.count + 1; return record.count; }
export const utils = { isObject: (value) => value !== null && typeof value === "object" && !Array.isArray(value), join: (a, b) => a + constants.SEP + b };

const pico = (glob) => (input) => input === glob;
pico.test = (input, glob) => input === glob ? { isMatch: true, output: input } : { isMatch: false, output: "" };
pico.makeRe = (glob) => new RegExp("^" + glob.replace(constants.REGEX_DOTS, "\\.") + "$");
pico.constants = constants;

function matcher(glob, options) { return pico(options && options.prefix ? options.prefix + glob : glob); }
Object.assign(matcher, pico, null, { version: "1.0" });
matcher.scan = (input) => ({ base: input.split(constants.SEP)[0], glob: input.slice(input.indexOf(constants.SEP) + 1) });

export default { matcher, utils, count: 3 };
