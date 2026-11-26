import { table, defineConfig, db, mutation } from "spacepress";

const run = (handler: () => unknown) => mutation({}, handler);

class ClassCounter {
  count = 1;
  history: string[] = [];
  early: string = this.later ?? "missing";
  later = "ready";
  constructor(public label: string = "base", count: number = 2) {
    this.count = count;
    this.history.push(`base:${this.count}`);
  }
  inc(n: number): number { this.count += n; return this.count; }
  reader(): () => number { return () => this.count; }
  static total = 3;
  static bump(): number { this.total++; return this.total; }
}
class ClassDouble extends ClassCounter {
  count = 10;
  constructor(label: string, public extra: number = 7) { super(label, 4); this.count++; }
  inc(n: number): number { return super.inc(n * 2); }
  static bump(): number { return super.bump() + 10; }
}
class ClassDefault extends ClassDouble {}
function classAsBase(value: ClassCounter): number { return value.inc(1); }
class ClassEffects {
  count: 0 | 1 = 0;
  mutate(value: { maybe: { n: number } | null }): void { this.count++; value.maybe = null; }
  read() { return this.count; }
}
class ClassConstructorEffect {
  constructor(value: { count: 0 | 1 }) { value.count++; }
}
class ClassDefaultOrder {
  count = 7;
  constructor(public n: number = this.count, public prior: number = this.n ?? 9) {}
}
class ClassVirtualBase {
  clear(value: { maybe: { n: number } | null }): void {}
}
class ClassVirtualChild extends ClassVirtualBase {
  clear(value: { maybe: { n: number } | null }): void { value.maybe = null; }
}
function classVirtual(value: ClassVirtualBase, data: { maybe: { n: number } | null }): void { value.clear(data); }
const classShared: { count: 0 | 1 } = { count: 0 };
class ClassStaticAlias {
  static shared = classShared;
  static count: 0 | 1 = 0;
  static mutate(): void { this.shared.count++; this.count++; }
}
const classStaticBuild = { count: 0 };
function classStaticNext(): number { classStaticBuild.count++; return classStaticBuild.count; }
class ClassStaticSeed { static first = classStaticNext(); }
class ClassDatabase {
  static allowed = true;
  async rows() { return await db.query.n.findMany(); }
}

export const n = table({  }, { access: { read: () => ClassDatabase.allowed } });

export const classesMutation = run(() => {
  const c = new ClassDefault("child");
  const alias = c;
  const read = c.reader();
  const result = c.inc(2);
  return { result, read: read(), same: c === alias, distinct: c !== new ClassDefault("child"), c,
    keys: Object.keys(c), copy: { ...c }, yes: c instanceof ClassCounter,
    child: c instanceof ClassDouble, no: {} instanceof ClassCounter,
    cloned: structuredClone(c) instanceof ClassCounter,
    constructorType: typeof ClassCounter, instanceType: typeof c,
    static: ClassDouble.bump(), baseStatic: ClassCounter.total,
    staticSeed: ClassStaticSeed.first, staticEvaluations: classStaticBuild.count };
});

export const classesWire = run(() => new ClassCounter("wire", 5));

export const classesEffects = run(() => {
  const c = new ClassEffects();
  const value: { maybe: { n: number } | null } = { maybe: { n: 1 } };
  const read = () => value.maybe;
  if (value.maybe) c.mutate(value);
  const constructorValue: { count: 0 | 1 } = { count: 0 };
  new ClassConstructorEffect(constructorValue);
  const virtual: { maybe: { n: number } | null } = { maybe: { n: 1 } };
  if (virtual.maybe) classVirtual(new ClassVirtualChild(), virtual);
  ClassStaticAlias.mutate();
  return { count: c.count, readCount: c.read(), maybe: value.maybe, captured: read(), constructorValue: constructorValue.count,
    virtual: virtual.maybe, staticCount: ClassStaticAlias.count, sharedCount: classShared.count };
});

export const classesDefaultOrder = run(() => new ClassDefaultOrder());

export const classesBaseArgument = run(() => classAsBase(new ClassDouble("base argument")));

export default defineConfig({ name: "class-tests" });
