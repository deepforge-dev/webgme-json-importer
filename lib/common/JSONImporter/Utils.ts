import NodeState from './NodeState';
import diff from 'changeset';

import { ChangeSet } from 'changeset';
import {NodeSelections, NodeSelector} from "./NodeSelectors";



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
    keys.forEach((key) => delete result[key]);
    return result;
}

export function compare(
    obj: Partial<NodeState>,
    obj2: Partial<NodeState>,
    ignore: (keyof NodeState)[] = ['id', 'children']
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
    predicate: (val: T) => boolean
): [Array<T>, Array<T>] {
    const partitioned: [Array<T>, Array<T>] = [[], []];
    arr.forEach((val: T) => {
        const partitionIndex: 0 | 1 = predicate(val) ? 0 : 1;
        partitioned[partitionIndex].push(val);
    });
    return partitioned;
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
