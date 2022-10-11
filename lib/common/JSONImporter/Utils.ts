import NodeState from './NodeState';
import diff from 'changeset';
import {ChangeSet} from 'changeset';
import Core = GmeClasses.Core;
import {NodeSelections, NodeSelector} from "./NodeSelectors";
import exp from "constants";

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

export function compare(obj: Partial<NodeState>, obj2: Partial<NodeState>, ignore: (keyof NodeState)[] = ['id', 'children']): ChangeSet[] {
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


export class Maybe<T> {
    private constructor(private value: T | null) {
        this.value = value;
    }

    static some<T>(value: T) {
        if (!value) {
            throw Error("Provided value must not be empty");
        }
        return new Maybe(value);
    }

    static none<T>() {
        return new Maybe<T>(null)
    }

    static fromValue<T>(value: T | null): Maybe<T>{
        return value ? Maybe.some(value) : Maybe.none<T>();
    }

    getOrElse(defaultValue: T) {
        return this.value === null ? defaultValue : this.value;
    }

    flatMap<R>(f: (wrapped: T) => Maybe<R>): Maybe<R> {
        if (this.value === null) {
            return Maybe.none();
        } else {
            return f(this.value);
        }
    }

    public isSome(): boolean {
        return !this.isNone()
    }

    public isNone(): boolean {
        return this.value === null || this.value === undefined
    }

    unwrap(): T | null {
        return this.value;
    }
}

export class Result<V, E> {
    _value: Maybe<V>;
    _error: Maybe<E>;

    constructor(value: Maybe<V>, error: Maybe<E>) {
        this._value = value;
        this._error = error;
    }

    map<V2>(fn: (item: V) => Maybe<V2>): Result<V2, E> {
        if(this._value.isSome()) {
            const result = this._value.flatMap(fn);
            return new Result<V2, E>(result, Maybe.none());
        } else {
            return new Result<V2, E>(Maybe.none(), this._error);
        }
    }

    mapError<E2>(errFn: (err: E) => Maybe<E2>): Result<V, E2> {
        if (this._error.isSome()) {
            const result = this._error.flatMap<E2>(errFn);
            return new Result(Maybe.none<V>(), result);
        } else {
            return new Result(this._value, Maybe.none());
        }
    }

    unwrap() {
        if(this._error.isSome()) {
            throw this._error.unwrap();
        } else {
            return this._value.unwrap();
        }
    }

    static Ok<V, E>(value: V) : Result<NonNullable<V>, E> {
        return new Result(
            Maybe.some<V>(value),
            Maybe.none<E>()
        )
    }

    static Error<V, E>(err: E) : Result<V, NonNullable<E>> {
        return new Result(
            Maybe.none<V>(),
            Maybe.some<E>(err),
        )
    }
}


export class NodeSearchUtils {
    core: GmeClasses.Core;
    rootNode: Core.Node;

    constructor(core: GmeClasses.Core, rootNode: Core.Node) {
        this.core = core;
        this.rootNode = rootNode;
    }

    getRoot(): Core.Node {
        return this.rootNode;
    }

    async getNodeId(parent: Core.Node, idString: string, resolvedSelectors: NodeSelections): Promise<GmeCommon.Path>{
        const node = await this.getNode(parent, idString, resolvedSelectors);
        return this.core.getPath(node);
    }

    async getNode(parent: Core.Node, idString: string, resolvedSelectors: NodeSelections): Promise<Core.Node> {
        const node = await this.findNode(parent, idString, resolvedSelectors);
        if (!node) {
            throw new Error(`Could not resolve ${idString} to an existing node.`);
        }
        return node;
    }

    async findNode(parent, idString, resolvedSelectors=new NodeSelections()) {
        if (idString === undefined) {
            return;
        }
        assert(typeof idString === 'string', `Expected ID to be a string but found ${JSON.stringify(idString)}`);

        const parentId = this.core.getPath(parent);
        const selector = new NodeSelector(idString);
        const resolved = resolvedSelectors.get(parentId, selector);
        if (resolved) {
            return resolved;
        }

        return await selector.findNode(this.core, this.rootNode, parent, resolvedSelectors.cache as NodeSelections);
    }
}