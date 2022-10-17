import { Exporter } from './Exporter';
import { NodeSelections, NodeSelector } from './NodeSelectors';
import { partition, NodeSearchUtils } from './Utils';
import { NodeChangeSet } from './NodeChangeSet';
import { OmittedProperties } from './OmittedProperties';
import { gmeDiff } from './SortedChanges';
import NodeState from './NodeState';
import { ChangeType } from 'changeset';
import {
    NodeStatePatch,
    AttributesPatch,
    AttributeMetaPatch,
    PointersPatch,
    GuidPatch,
    MixinsPatch,
    PointerMetaPatch,
    SetsPatch,
    MemberAttributesPatch,
    MemberRegistryPatch,
    RegistryPatch,
    ChildrenPatch,
    ChildrenMetaPatch,
} from './NodeStatePatch';

export class Importer {
    _nodeIDCounter: number = 1;
    core: GmeClasses.Core;
    rootNode: Core.Node;
    exporter: Exporter;
    searchUtils: NodeSearchUtils;
    patchers: {
        [key in Exclude<keyof NodeState, 'id' | 'path' | 'alias'>]: NodeStatePatch;
    };

    constructor(core: GmeClasses.Core, rootNode: Core.Node) {
        this.core = core;
        this.rootNode = rootNode;
        this.exporter = new Exporter(this.core, this.rootNode);
        this.searchUtils = new NodeSearchUtils(this.core, this.rootNode);
        this.patchers = {
            attributes: new AttributesPatch(this.core, this.searchUtils),
            attribute_meta: new AttributeMetaPatch(this.core, this.searchUtils),
            pointers: new PointersPatch(this.core, this.searchUtils),
            pointer_meta: new PointerMetaPatch(this.core, this.searchUtils),
            guid: new GuidPatch(this.core, this.searchUtils),
            mixins: new MixinsPatch(this.core, this.searchUtils),
            sets: new SetsPatch(this.core, this.searchUtils),
            member_attributes: new MemberAttributesPatch(
                this.core,
                this.searchUtils
            ),
            member_registry: new MemberRegistryPatch(
                this.core,
                this.searchUtils
            ),
            registry: new RegistryPatch(this.core, this.searchUtils),
            children: new ChildrenPatch(this.core, this.searchUtils, this),
            children_meta: new ChildrenMetaPatch(this.core, this.searchUtils),
        };
    }

    getPatcher(key: keyof NodeState): NodeStatePatch | undefined {
        return this.patchers[key];
    }

    async toJSON(
        node: Core.Node,
        omittedProperties: OmittedProperties | boolean = new OmittedProperties()
    ) {
        return await this.exporter.toJSON(node, omittedProperties);
    }

    async apply(
        node: Core.Node,
        state: NodeState,
        resolvedSelectors = new NodeSelections()
    ) {
        const diffs = await this.diff(node, state, resolvedSelectors);
        await this._patch(diffs, resolvedSelectors);
    }

    async diff(
        node: Core.Node,
        state: NodeState,
        resolvedSelectors = new NodeSelections()
    ) {
        await this.resolveSelectorsForExistingNodes(
            node,
            state,
            resolvedSelectors
        );

        const parent = this.core.getParent(node);
        const parentPath = this.core.getPath(parent) || '';
        const nodePath = this.core.getPath(node);
        const diffs = [];
        const children = state.children || [];
        const currentChildren = await this.core.loadChildren(node);
        diffs.push(
            ...(
                await Promise.all(
                    children.map(async (childState) => {
                        const idString = childState.id;
                        const childNode = await this.findNode(
                            node,
                            idString,
                            resolvedSelectors
                        );
                        const index = currentChildren.indexOf(childNode);
                        if (index > -1) {
                            currentChildren.splice(index, 1);
                        }
                        if (childNode) {
                            const childDiffs = await this.diff(
                                childNode,
                                childState,
                                resolvedSelectors
                            );
                            return childDiffs;
                        } else {
                            return [
                                new NodeChangeSet(
                                    nodePath,
                                    childState.id || '',
                                    ChangeType.PUT,
                                    ['children'],
                                    childState
                                ),
                            ];
                        }
                    })
                )
            ).flat()
        );
        const current = await this.toJSON(
            node,
            new OmittedProperties(['children'])
        );
        const changes = gmeDiff(current, state);
        if (changes.length) {
            diffs.push(
                ...changes.map((change) =>
                    NodeChangeSet.fromChangeSet(
                        parentPath,
                        state.id || nodePath,
                        change
                    )
                )
            );
        }

        if (state.children && currentChildren.length) {
            const deletions = currentChildren.map((child) => {
                const childPath = this.core.getPath(child);
                return new NodeChangeSet(
                    nodePath,
                    childPath,
                    ChangeType.DEL,
                    ['children'],
                    childPath
                );
            });
            diffs.push(...deletions);
        }

        return diffs;
    }

    async patch(node, diffs, resolvedSelectors = new NodeSelections()) {
        await this.resolveSelectorsFromDiffs(node, diffs, resolvedSelectors);
        await this._patch(diffs, resolvedSelectors);
    }

    async _patch(diffs, resolvedSelectors) {
        const [firstOrderDiffs, dependentDiffs] =
            this._partitionDiffsByPriority(diffs);
        const apply = (diffs) => {
            return diffs.map(async (diff) => {
                let node = null;
                const isNewNode =
                    diff.type === 'put' && diff.key[0] === 'children';
                if (!isNewNode) {
                    const parent = await this.core.loadByPath(
                        this.rootNode,
                        diff.parentPath
                    );
                    node = await this.findNode(
                        parent,
                        diff.nodeId,
                        resolvedSelectors
                    );
                }

                if (diff.type === 'put') {
                    return await this._put(node, diff, resolvedSelectors);
                } else if (diff.type === 'del') {
                    return await this._delete(node, diff, resolvedSelectors);
                }
            });
        };

        await Promise.all(apply(firstOrderDiffs));
        await Promise.all(apply(dependentDiffs));
    }

    _partitionDiffsByPriority(diffs) {
        const isIdBasedCreation = (diff) => {
            const type = diff.type;
            const [key] = diff.key;
            const nodeSelectorKey = diff.nodeId.slice(0, 2);
            return (
                type === 'put' &&
                key === 'children' &&
                nodeSelectorKey === '@id'
            );
        };
        return partition(diffs, isIdBasedCreation);
    }

    resolveSelector(node, state, resolvedSelectors) {
        const parent = this.core.getParent(node);

        if (!parent) {
            throw new Error(`Cannot resolve selector ${state.id}: no parent`);
        }
        if (state.id) {
            const parentId = this.core.getPath(parent);
            const selector = new NodeSelector(state.id);
            resolvedSelectors.record(parentId, selector, node);
            if (state.alias) {
                const selector = new NodeSelector('@id:' + state.alias);
                resolvedSelectors.record(parentId, selector, node);
            }
        }
    }

    getChildStateNodePairs(node, state) {
        return (state.children || []).map((s) => [s, node]);
    }

    async tryResolveSelectors(stateNodePairs, resolvedSelectors, create) {
        let tryResolveMore = true;
        while (tryResolveMore) {
            tryResolveMore = false;
            for (let i = stateNodePairs.length; i--; ) {
                const [state, parentNode] = stateNodePairs[i];
                let child = await this.findNode(
                    parentNode,
                    state.id,
                    resolvedSelectors
                );
                //const canCreate = !state.id;
                if (!child && create) {
                    let baseNode;
                    if (state.pointers) {
                        const { base } = state.pointers;
                        if (!base) {
                            const stateID = state.id || JSON.stringify(state);
                            throw new Error(`No base provided for ${stateID}`);
                        }
                        baseNode = await this.findNode(
                            parentNode,
                            base,
                            resolvedSelectors
                        );
                    } else {
                        const fco = await this.core.loadByPath(
                            this.rootNode,
                            '/1'
                        );
                        baseNode = fco;
                    }

                    if (baseNode) {
                        child = await this.createNode(
                            parentNode,
                            state,
                            baseNode
                        );
                    }
                }
                let pairs = [];
                if (child) {
                    this.resolveSelector(
                        child,
                        state,
                        resolvedSelectors,
                        create
                    );
                    pairs = this.getChildStateNodePairs(child, state);
                    tryResolveMore = true;
                }
                stateNodePairs.splice(i, 1, ...pairs);
            }
        }

        if (stateNodePairs.length) {
            throw new Error(
                'Cannot resolve all node selectors (circular references)'
            );
        }
    }

    async resolveSelectorsForExistingNodes(node, state, resolvedSelectors) {
        await this.resolveSelectors(node, state, resolvedSelectors, false);
    }

    async resolveSelectorsFromDiffs(node, diffs, resolvedSelectors) {
        await Promise.all(
            diffs.map(async (diff) => {
                const selector = new NodeSelector(diff.nodeId);
                const parent = await this.core.loadByPath(
                    this.rootNode,
                    diff.parentPath
                );
                const node = await selector.findNode(
                    this.core,
                    this.rootNode,
                    parent,
                    resolvedSelectors
                );
                if (node) {
                    resolvedSelectors.record(diff.parentPath, selector, node);
                }
            })
        );
    }

    async resolveSelectors(node, state, resolvedSelectors, create = true) {
        const parent = this.core.getParent(node);
        if (parent) {
            this.resolveSelector(
                node,
                { id: this.core.getPath(node) },
                resolvedSelectors
            );
        }
        if (state.id && parent) {
            this.resolveSelector(node, state, resolvedSelectors);
        }

        const stateNodePairs = this.getChildStateNodePairs(node, state);
        await this.tryResolveSelectors(
            stateNodePairs,
            resolvedSelectors,
            create
        );
    }

    async createNode(parent, state = {}, base) {
        if (!state.id) {
            state.id = `@internal:${this._nodeIDCounter++}`;
        }
        const idString = state.id;
        const fco = await this.core.loadByPath(this.rootNode, '/1');
        const selector = new NodeSelector(idString);
        const params = selector.prepareCreateParams({
            base: base || fco,
            parent,
            relid: state.path?.split('/').pop(),
        });

        if (state.guid) {
            params.guid = state.guid;
        }
        const node = this.core.createNode(params);
        await selector.prepare(this.core, this.rootNode, node);
        return node;
    }

    async createStateSubTree(parentPath, state, resolvedSelectors) {
        const base = state.pointers?.base;
        const parent = await this.core.loadByPath(this.rootNode, parentPath);
        const baseNode = await this.findNode(parent, base, resolvedSelectors);
        const created = await this.createNode(parent, state, baseNode);
        const nodeSelector = new NodeSelector(this.core.getPath(created));
        resolvedSelectors.record(parentPath, nodeSelector, created);
        if (state.id && !state.id.startsWith('@internal')) {
            const alternateSelector = new NodeSelector(state.id);
            resolvedSelectors.record(parentPath, alternateSelector, created);
        }
        const nodeState = await this.toJSON(
            created,
            new OmittedProperties(['children'])
        );
        const changes = gmeDiff(nodeState, state).map((change) =>
            NodeChangeSet.fromChangeSet(parentPath, state.id, change)
        );
        await Promise.all(
            changes.map(async (change) => {
                await this._put(created, change, resolvedSelectors);
            })
        );
        await Promise.all(
            (state.children || []).map(async (child) => {
                await this.createStateSubTree(
                    this.core.getPath(created),
                    child,
                    resolvedSelectors
                );
            })
        );

        return created;
    }

    async _put(node, change, resolvedSelectors: NodeSelections) {
        const [type] = change.key;
        if (type !== 'path' && type !== 'id') {
            const patcher = this.getPatcher(type);
            if (patcher) {
                const result = await patcher.put(
                    node,
                    change,
                    resolvedSelectors
                );
                return result.unwrap();
            }
        }
    }

    async _delete(node, change, resolvedSelectors: NodeSelections) {
        const [type] = change.key;
        if (change.key.length > 1 || type === 'children') {
            const patcher = this.getPatcher(type);
            if (patcher) {
                const result = await patcher.delete(
                    node,
                    change,
                    resolvedSelectors
                );
                return result.unwrap();
            }
        }
    }

    async import(parent, state) {
        const node = await this.createNode(parent, state);
        await this.apply(node, state);
        return node;
    }

    async getNode(
        parent: Core.Node,
        idString: string,
        resolvedSelectors: NodeSelections = new NodeSelections()
    ): Promise<Core.Node> {
        return await this.searchUtils.getNode(
            parent,
            idString,
            resolvedSelectors
        );
    }

    async findNode(
        parent: Core.Node,
        idString: string,
        resolvedSelectors: NodeSelections = new NodeSelections()
    ): Promise<Core.Node> {
        return await this.searchUtils.findNode(
            parent,
            idString,
            resolvedSelectors
        );
    }
}
