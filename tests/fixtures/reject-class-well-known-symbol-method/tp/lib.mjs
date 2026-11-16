class Range {
  *[Symbol.iterator]() { yield 1; yield 2; }
}
export const make = () => [...new Range()];
