import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Two kinds of work that must never overlap in this process.
 *
 * The serializer puts happy-dom's globals on `globalThis` while it works
 * (`dom`), and an authored module must never run while they are there
 * (`module`): a file that reads `typeof document` would otherwise compile
 * differently depending on which other compile happened to be in flight.
 *
 * Work of one kind overlaps freely with work of the same kind: DOM users share
 * one installation (the serializer counts them), and module executions are
 * independent. Work of the other kind waits until every member of the active
 * group has finished, nested members included, so the globals never outlive
 * the group. A request for the other kind made from inside an active group
 * (`withBlockApi(() => compileContent(...))`) could only ever wait for itself,
 * so it is refused at once with an error that says so.
 *
 * Same-kind arrivals always join an active group, even with the other kind
 * waiting: queueing them would let a member that awaits an outsider of its
 * own kind deadlock the group. The other kind is delayed only by work already
 * in flight, which is finite.
 */
export type Kind = "dom" | "module";

interface Group {
  readonly kind: Kind;
  /** Carried in the async context of every member, so a cross-kind request from inside can be told apart from an outsider. */
  readonly token: object;
  active: number;
}

interface Waiter {
  readonly kind: Kind;
  start(group: Group): void;
}

const context = new AsyncLocalStorage<object>();
let current: Group | null = null;
const waiting: Waiter[] = [];

export function exclusive<T>(kind: Kind, work: () => Promise<T>): Promise<T> {
  if (current !== null && current.kind !== kind && context.getStore() === current.token) {
    return Promise.reject(new Error(`${describe(kind)} cannot start inside ${describe(current.kind)}: it would wait for the work that is waiting for it. Finish one before starting the other.`));
  }
  if (current === null) current = { kind, token: {}, active: 0 };
  if (current.kind === kind) return join(current, work);
  return new Promise<T>((resolve, reject) => {
    waiting.push({ kind, start: (group) => join(group, work).then(resolve, reject) });
  });
}

function describe(kind: Kind): string {
  return kind === "dom" ? "the block API (withBlockApi, serializeBlocks)" : "module execution (compileContent, renderModule)";
}

async function join<T>(group: Group, work: () => Promise<T>): Promise<T> {
  group.active += 1;
  try {
    return await context.run(group.token, work);
  } finally {
    group.active -= 1;
    if (group.active === 0 && current === group) release();
  }
}

/** The active group has emptied: start the next group, every waiter of its kind at once. */
function release(): void {
  current = null;
  const first = waiting.shift();
  if (first === undefined) return;
  const group: Group = { kind: first.kind, token: {}, active: 0 };
  current = group;
  const batch = [first];
  for (let index = 0; index < waiting.length; ) {
    if (waiting[index]!.kind === group.kind) batch.push(...waiting.splice(index, 1));
    else index += 1;
  }
  // Each start() increments `active` synchronously, so the group cannot empty while the batch is still being started.
  for (const waiter of batch) waiter.start(group);
}
