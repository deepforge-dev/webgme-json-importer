import NodeState from "./NodeState";
import diff from "changeset";
import { ChangeSet } from "changeset";

export const Constants = {
  META_ASPECT_SET_NAME: "MetaAspectSet",
} as const;

export function assert(cond: any, msg = "ASSERT failed") {
  if (!cond) {
    throw new Error(msg);
  }
}

export function omit<T>(obj: T, keys: (keyof T)[]): Partial<T> {
  const result = Object.assign({}, obj);
  keys.forEach((key) => delete result[key]);
  return result;
}

export function compare(
  obj: Partial<NodeState>,
  obj2: Partial<NodeState>,
  ignore: (keyof NodeState)[] = ["id", "children"],
): ChangeSet[] {
  return diff(omit(obj, ignore), omit(obj2, ignore));
}

export function setNested(object: any, keys: any[], value: any) {
  let current = object;
  while (keys.length > 1) {
    current = current[keys.shift()];
  }
  current[keys.shift()] = value;
  return object;
}

export function partition<T>(
  arr: Array<T>,
  predicate: (val: T) => boolean,
): [Array<T>, Array<T>] {
  const partitioned: [Array<T>, Array<T>] = [[], []];
  arr.forEach((val: T) => {
    const partitionIndex: 0 | 1 = predicate(val) ? 0 : 1;
    partitioned[partitionIndex].push(val);
  });
  return partitioned;
}
