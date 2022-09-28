import {DiffObj, GMEJSONNodeType} from './Models';
import {diff} from './Changeset';

export const Constants = {
    META_ASPECT_SET_NAME: 'MetaAspectSet',
} as const;

export function assert(cond: any, msg = 'ASSERT failed') {
    if (!cond) {
        throw new Error(msg);
    }
}

export function omit<T>(obj: T, keys: (keyof T)[]): Partial<T> {
    const result = Object.assign({}, obj);
    keys.forEach(key => delete result[key]);
    return result;
}

export function compare(obj: Partial<GMEJSONNodeType>, obj2: Partial<GMEJSONNodeType>, ignore: (keyof GMEJSONNodeType)[] = ['id', 'children']): DiffObj[] {
    return diff(
        omit(obj, ignore),
        omit(obj2, ignore),
    );
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
    const partitioned: [Array<T>, Array<T>] = [[], []]
    arr.forEach((val: T) => {
        const partitionIndex: 0 | 1 = predicate(val) ? 0 : 1
        partitioned[partitionIndex].push(val)
    });
    return partitioned;
}