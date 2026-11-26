// Module top level, so configuration evaluation runs the sort.
export const ORDER = [3, 1, 2].sort(function* (a, b) { return a - b; });
