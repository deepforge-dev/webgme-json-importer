import {Exporter} from './Exporter';
import {NodeSelections, NodeSelector} from './NodeSelectors';
import {assert, partition, setNested} from './Utils';
import {NodeChangeSet} from './NodeChangeSet';
import {OmittedProperties} from './OmittedProperties';
import {gmeDiff} from './SortedChanges';
import diff from 'changeset';
import NodeState from './NodeState';
import {ChangeType} from 'changeset';

export class Importer {

    _nodeIDCounter: number = 1;
    core: GmeClasses.Core;
    rootNode: Core.Node;
    exporter: Exporter;

    constructor(core: GmeClasses.Core, rootNode: Core.Node) {
        this.core = core;
        this.rootNode = rootNode;
        this.exporter = new Exporter(this.core, this.rootNode);
    }

    async toJSON(node: Core.Node, omittedProperties: OmittedProperties | boolean = new OmittedProperties()) {
        return await this.exporter.toJSON(node, omittedProperties);
    }

    async apply(node: Core.Node, state: NodeState, resolvedSelectors = new NodeSelections()) {
        const diffs = await this.diff(node, state, resolvedSelectors);
        await this._patch(diffs, resolvedSelectors);
    }

    async diff(node: Core.Node, state: NodeState, resolvedSelectors=new NodeSelections()) {
        await this.resolveSelectorsForExistingNodes(node, state, resolvedSelectors);

        const parent = this.core.getParent(node);
        const parentPath = this.core.getPath(parent) || '';
        const nodePath = this.core.getPath(node);
        const diffs = [];
        const children = state.children || [];
        const currentChildren = await this.core.loadChildren(node);
        diffs.push(...(await Promise.all(children.map(async childState => {
            const idString = childState.id;
            const childNode = await this.findNode(node, idString, resolvedSelectors);
            const index = currentChildren.indexOf(childNode);
            if (index > -1) {
                currentChildren.splice(index, 1);
            }
            if (childNode) {
                const childDiffs = await this.diff(childNode, childState, resolvedSelectors);
                return childDiffs;
            } else {
                return [
                    new NodeChangeSet(
                        nodePath,
                        childState.id || '',
                        ChangeType.PUT,
                        ['children'],
                        childState
                    )
                ];
            }
        }))).flat());
        const current = await this.toJSON(node, new OmittedProperties(['children']));
        const changes = gmeDiff(current, state);
        if(changes.length) {
            diffs.push(...changes.map(
                change => NodeChangeSet.fromChangeSet(
                    parentPath,
                    state.id || nodePath,
                    change
                )
            ));
        }

        if(state.children && currentChildren.length) {
            const deletions = currentChildren.map(child =>{
                const childPath = this.core.getPath(child);
                return new NodeChangeSet(
                    nodePath,
                    childPath,
                    ChangeType.DEL,
                    ['children'],
                    childPath
                )
            });
            diffs.push(...deletions);
        }

        return diffs;
    }

    async patch(node, diffs, resolvedSelectors=new NodeSelections()) {
        await this.resolveSelectorsFromDiffs(node, diffs, resolvedSelectors);
        await this._patch(diffs, resolvedSelectors);
    }

    async _patch(diffs, resolvedSelectors) {
        const [firstOrderDiffs, dependentDiffs] = this._partitionDiffsByPriority(diffs);
        const apply = diffs => {
            return diffs.map(async diff => {
                let node = null;
                const isNewNode = (diff.type === 'put' && diff.key[0] === 'children');
                if (!isNewNode) {
                    const parent = await this.core.loadByPath(this.rootNode, diff.parentPath);
                    node = await this.findNode(parent, diff.nodeId, resolvedSelectors);
                }

                if(diff.type === 'put') {
                    return await this._put(node, diff, resolvedSelectors);
                } else if(diff.type === 'del') {
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
            const [key,] = diff.key;
            const nodeSelectorKey = diff.nodeId.slice(0, 2);
            return type === 'put' && key === 'children' && nodeSelectorKey === '@id';
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
        return (state.children || []).map(s => [s, node]);
    }

    async tryResolveSelectors(stateNodePairs, resolvedSelectors, create) {
        let tryResolveMore = true;
        while (tryResolveMore) {
            tryResolveMore = false;
            for (let i = stateNodePairs.length; i--;) {
                const [state, parentNode] = stateNodePairs[i];
                let child = await this.findNode(parentNode, state.id, resolvedSelectors);
                //const canCreate = !state.id;
                if (!child && create) {
                    let baseNode;
                    if (state.pointers) {
                        const {base} = state.pointers;
                        if (!base) {
                            const stateID = state.id || JSON.stringify(state);
                            throw new Error(`No base provided for ${stateID}`);
                        }
                        baseNode = await this.findNode(parentNode, base, resolvedSelectors);


                    } else {
                        const fco = await this.core.loadByPath(this.rootNode, '/1');
                        baseNode = fco;
                    }

                    if (baseNode) {
                        child = await this.createNode(parentNode, state, baseNode);
                    }
                }
                let pairs = [];
                if (child) {
                    this.resolveSelector(child, state, resolvedSelectors, create);
                    pairs = this.getChildStateNodePairs(child, state);
                    tryResolveMore = true;
                }
                stateNodePairs.splice(i, 1, ...pairs);
            }
        }

        if (stateNodePairs.length) {
            throw new Error('Cannot resolve all node selectors (circular references)');
        }
    }

    async resolveSelectorsForExistingNodes(node, state, resolvedSelectors) {
        await this.resolveSelectors(node, state, resolvedSelectors, false);
    }

    async resolveSelectorsFromDiffs(node, diffs, resolvedSelectors) {
        await Promise.all(diffs.map(async diff => {
            const selector = new NodeSelector(diff.nodeId);
            const parent = await this.core.loadByPath(this.rootNode, diff.parentPath);
            const node = await selector.findNode(this.core, this.rootNode, parent, resolvedSelectors);
            if(node) {
                resolvedSelectors.record(diff.parentPath, selector, node);
            }
        }));
    }

    async resolveSelectors(node, state, resolvedSelectors, create=true) {
        const parent = this.core.getParent(node);
        if(parent) {
            this.resolveSelector(node, {id: this.core.getPath(node)}, resolvedSelectors);
        }
        if (state.id && parent) {
            this.resolveSelector(node, state, resolvedSelectors);
        }

        const stateNodePairs = this.getChildStateNodePairs(node, state);
        await this.tryResolveSelectors(stateNodePairs, resolvedSelectors, create);
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

        return await selector.findNode(this.core, this.rootNode, parent, resolvedSelectors.cache);
    }

    async getNode(parent, idString, resolvedSelectors) {
        const node = await this.findNode(parent, idString, resolvedSelectors);
        if (!node) {
            throw new Error(`Could not resolve ${idString} to an existing node.`);
        }
        return node;
    }

    async getNodeId(parent, id, resolvedSelectors) {
        const node = await this.getNode(parent, id, resolvedSelectors);
        return this.core.getPath(node);
    }

    async createNode(parent, state={}, base) {
        if (!state.id) {
            state.id = `@internal:${this._nodeIDCounter++}`;
        }
        const idString = state.id;
        const fco = await this.core.loadByPath(this.rootNode, '/1');
        const selector = new NodeSelector(idString);
        const params = selector.prepareCreateParams({
                base: base || fco,
                parent,
                relid: state.path?.split('/').pop()
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
        if(state.id && !state.id.startsWith('@internal')) {
            const alternateSelector = new NodeSelector(state.id);
            resolvedSelectors.record(parentPath, alternateSelector, created);
        }
        const nodeState = await this.toJSON(created, new OmittedProperties(['children']));
        const changes = gmeDiff(nodeState, state);
        await Promise.all(changes.map(async change => {
            await this._put(created, change, resolvedSelectors);
        }));
        await Promise.all((state.children || []).map(async child => {
            await this.createStateSubTree(this.core.getPath(created), child, resolvedSelectors);
        }));

        return created;
    }

    async _put (node, change) {
        const [type] = change.key;
        if (type !== 'path' && type !== 'id') {
            if (!this._put[type]) {
                throw new Error(`Unrecognized key ${type}`);
            }
            return await this._put[type].call(this, ...arguments);
        }
    }

    async _delete (node, change) {
        const [type] = change.key;
        if (change.key.length > 1 || type === 'children') {
            if (!this._delete[type]) {
                throw new Error(`Unrecognized key ${type}`);
            }
            return await this._delete[type].call(this, ...arguments);
        }
    }

    async import(parent, state) {
        const node = await this.createNode(parent, state);
        await this.apply(node, state);
        return node;
    }
}

Importer.prototype._put.children = async function(node, change, resolvedSelectors) {
    const created = await this.createStateSubTree(change.parentPath, change.value, resolvedSelectors);
    return created;
};

Importer.prototype._delete.children = async function(node, /*change, resolvedSelectors*/) {
    this.core.deleteNode(node);
};

Importer.prototype._put.guid = async function(node, change, resolvedSelectors) {
    const {value} = change;
    this.core.setGuid(node, value);
};

Importer.prototype._put.mixins = async function(node, change, resolvedSelectors) {
    const [, index] = change.key;
    const oldMixinPath = this.core.getMixinPaths(node)[index];
    if (oldMixinPath) {
        this.core.delMixin(node, oldMixinPath);
    }

    const mixinId = change.value;
    const mixinPath = await this.getNodeId(node, mixinId, resolvedSelectors);
    const canSet = this.core.canSetAsMixin(node, mixinPath);
    if (canSet.isOk) {
        this.core.addMixin(node, mixinPath);
    } else {
        throw new Error(`Cannot set ${mixinId} as mixin for ${this.core.getPath(node)}: ${canSet.reason}`);
    }
};

Importer.prototype._put.attributes = function(node, change) {
    assert(
        change.key.length === 2,
        `Complex attributes not currently supported: ${change.key.join(', ')}`
    );
    const [/*type*/, name] = change.key;
    this.core.setAttribute(node, name, change.value || '');
};

Importer.prototype._delete.attributes = function(node, change) {
    assert(
        change.key.length === 2,
        `Complex attributes not currently supported: ${change.key.join(', ')}`
    );
    const [/*type*/, name] = change.key;
    this.core.delAttribute(node, name);
};

Importer.prototype._put.attribute_meta = function(node, change) {
    const [/*type*/, name] = change.key;
    const keys = change.key.slice(2);
    if (keys.length) {
        const value = this.core.getAttributeMeta(node, name);
        setNested(value, keys, change.value);
        this.core.setAttributeMeta(node, name, value);
    } else {
        this.core.setAttributeMeta(node, name, change.value);
    }
};

Importer.prototype._delete.attribute_meta = function(node, change) {
    const isAttrDeletion = change.key.length === 2;
    const [/*type*/, name] = change.key;
    if (isAttrDeletion) {
        this.core.delAttributeMeta(node, name);
    } else {
        const meta = this.core.getAttributeMeta(node, name);
        const metaChange = {type: 'del', key: change.key.slice(2)};
        const newMeta = diff.apply([metaChange], meta);
        this.core.setAttributeMeta(node, name, newMeta);
    }
};

Importer.prototype._put.pointers = async function(node, change, resolvedSelectors) {
    assert(
        change.key.length === 2,
        `Invalid key for pointer: ${change.key.slice(1).join(', ')}`
    );
    const [/*type*/, name] = change.key;
    let target = null;
    let targetPath = null;
    if (change.value !== null) {
        target = change.value !== null ?
            await this.getNode(node, change.value, resolvedSelectors)
            : null;
        targetPath = this.core.getPath(target);
    }
    const hasChanged = targetPath !== this.core.getPointerPath(node, name);
    if (hasChanged) {
        this.core.setPointer(node, name, target);
    }
};

Importer.prototype._delete.pointers = function(node, change) {
    assert(
        change.key.length === 2,
        `Invalid key for pointer: ${change.key.slice(1).join(', ')}`
    );
    const [/*type*/, name] = change.key;
    this.core.delPointer(node, name);
};

Importer.prototype._put.pointer_meta = async function(node, change, resolvedSelectors) {
    const [/*"pointer_meta"*/, name, idOrMinMax] = change.key;
    const isNewPointer = change.key.length === 2;

    if (isNewPointer) {
        const meta = change.value;
        this.core.setPointerMetaLimits(node, name, meta.min, meta.max);

        const targets = Object.entries(change.value)
            .filter(pair => {
                const [key, /*value*/] = pair;
                return !['min', 'max'].includes(key);
            });

        for (let i = targets.length; i--;) {
            const [nodeId, meta] = targets[i];
            const target = await this.getNode(node, nodeId, resolvedSelectors);
            this.core.setPointerMetaTarget(node, name, target, meta.min, meta.max);
        }
    } else if (['min', 'max'].includes(idOrMinMax)) {
        const meta = this.core.getPointerMeta(node, name);
        meta[idOrMinMax] = change.value;
        this.core.setPointerMetaLimits(node, name, meta.min, meta.max);
    } else {
        const meta = this.core.getPointerMeta(node, name);
        const target = await this.getNode(node, idOrMinMax, resolvedSelectors);
        const gmeId = await this.core.getPath(target);
        const keys = change.key.slice(2);
        keys[0] = gmeId;
        setNested(meta, keys, change.value);

        const targetMeta = meta[gmeId];
        this.core.setPointerMetaTarget(node, name, target, targetMeta.min, targetMeta.max);
    }
};

Importer.prototype._delete.pointer_meta = async function(node, change, resolvedSelectors) {
    const [/*type*/, name, targetId] = change.key;
    const removePointer = targetId === undefined;
    if (removePointer) {
        this.core.delPointerMeta(node, name);
    } else {
        const gmeId = await this.getNodeId(node, targetId, resolvedSelectors);
        this.core.delPointerMetaTarget(node, name, gmeId);
    }
};

Importer.prototype._delete.mixins = async function(node, change, resolvedSelectors) {
    const [, index] = change.key;
    const mixinPath = this.core.getMixinPaths(node)[index];
    this.core.delMixin(node, mixinPath);
};

Importer.prototype._put.children_meta = async function(node, change, resolvedSelectors) {
    const [/*"children_meta"*/, idOrUndef] = change.key;
    const isAddingContainment = !idOrUndef;
    const isNewChildDefinition = typeof idOrUndef === 'string';
    if (isAddingContainment) {
        const {min, max} = change.value;
        this.core.setChildrenMetaLimits(node, min, max);
        const childEntries = Object.entries(change.value).filter(pair => !['min', 'max'].includes(pair[0]));
        for (let i = 0; i < childEntries.length; i++) {
            const [nodeId, {min, max}] = childEntries[i];
            const childNode = await this.getNode(node, nodeId, resolvedSelectors);
            this.core.setChildMeta(node, childNode, min, max);
        }
    } else if (isNewChildDefinition) {
        const nodeId = idOrUndef;
        const {min, max} = change.value;
        const childNode = await this.getNode(node, nodeId, resolvedSelectors);
        this.core.setChildMeta(node, childNode, min, max);
    }
};

Importer.prototype._delete.children_meta = async function(node, change, resolvedSelectors) {
    const [/*"children_meta"*/, idOrMinMax] = change.key;
    const isNodeId = !['min', 'max'].includes(idOrMinMax);
    if (isNodeId) {
        const gmeId = await this.getNodeId(node, idOrMinMax, resolvedSelectors);
        this.core.delChildMeta(node, gmeId);
    }
};

Importer.prototype._put.sets = async function(node, change, resolvedSelectors) {
    const [/*type*/, name] = change.key;
    const isNewSet = change.key.length === 2;
    if (isNewSet) {
        this.core.createSet(node, name);
        const memberPaths = change.value;

        for (let i = 0; i < memberPaths.length; i++) {
            const member = await this.getNode(node, memberPaths[i], resolvedSelectors);
            this.core.addMember(node, name, member);
        }
    } else {
        const member = await this.getNode(node, change.value, resolvedSelectors);
        this.core.addMember(node, name, member);
    }
};

Importer.prototype._delete.sets = async function(node, change) {
    const [/*type*/, name, index] = change.key;
    const removeSet = index === undefined;
    if (removeSet) {
        this.core.delSet(node, name);
    } else {
        const member = this.core.getMemberPaths(node, name)[index];
        this.core.delMember(node, name, member);
    }
};

Importer.prototype._put.member_attributes = async function(node, change, resolvedSelectors) {
    const [/*type*/, set, nodeId, name] = change.key;
    const isNewSet = nodeId === undefined;
    const isNewMember = name === undefined;
    if (isNewSet || isNewMember) {
        const changesets = Object.entries(change.value)
            .map(entry => ({
                type: 'put',
                key: change.key.concat([entry[0]]),
                value: entry[1],
            }));

        for (let i = changesets.length; i--;) {
            await this._put(node, changesets[i], resolvedSelectors);
        }
    } else {
        const gmeId = await this.getNodeId(node, nodeId, resolvedSelectors);
        this.core.setMemberAttribute(node, set, gmeId, name, change.value);
    }
};

Importer.prototype._delete.member_attributes = async function(node, change, resolvedSelectors) {
    const [/*type*/, set, nodeId, name] = change.key;
    const gmeId = await this.getNodeId(node, nodeId, resolvedSelectors);
    const deleteAllAttributes = name === undefined;
    const isMember = this.core.getMemberPaths(node, set).includes(gmeId);

    if (isMember) {
        const attributeNames = deleteAllAttributes ?
            this.core.getMemberAttributeNames(node, set, gmeId) : [name];

        attributeNames.forEach(name => {
            this.core.delMemberAttribute(node, set, gmeId, name);
        });
    } else {
        if (!deleteAllAttributes) {
            const member = await this.core.loadByPath(this.rootNode, gmeId);
            const memberName = this.core.getAttribute(member, 'name');
            const memberDisplay = `${memberName} (${gmeId})`;

            throw new Error(`Cannot delete partial member attributes for ${memberDisplay}`);
        }
    }

};

Importer.prototype._put.member_registry = async function(node, change, resolvedSelectors) {
    const [/*type*/, set, nodeId, name] = change.key;
    const isNewSet = nodeId === undefined;
    const isNewMember = name === undefined;
    if (isNewSet || isNewMember) {
        const changesets = Object.entries(change.value)
            .map(entry => ({
                type: 'put',
                key: change.key.concat([entry[0]]),
                value: entry[1],
            }));

        for (let i = changesets.length; i--;) {
            await this._put(node, changesets[i], resolvedSelectors);
        }
    } else {
        const gmeId = await this.getNodeId(node, nodeId, resolvedSelectors);
        const isNested = change.key.length > 4;
        if (isNested) {
            const value = this.core.getMemberRegistry(node, set, gmeId, name);
            setNested(value, change.key.slice(4), change.value);
            this.core.setMemberRegistry(node, set, gmeId, name, value);
        } else {
            this.core.setMemberRegistry(node, set, gmeId, name, change.value);
        }
    }
};

Importer.prototype._delete.member_registry = async function(node, change, resolvedSelectors) {
    const [/*type*/, set, nodeId, name] = change.key;
    const gmeId = await this.getNodeId(node, nodeId, resolvedSelectors);
    const deleteAllRegistryValues = name === undefined;
    const isMember = this.core.getMemberPaths(node, set).includes(gmeId);

    if (isMember) {
        const attributeNames = deleteAllRegistryValues ?
            this.core.getMemberRegistryNames(node, set, gmeId) : [name];

        attributeNames.forEach(name => {
            this.core.delMemberRegistry(node, set, gmeId, name);
        });
    } else {
        if (!deleteAllRegistryValues) {
            const member = await this.core.loadByPath(this.rootNode, gmeId);
            const memberName = this.core.getAttribute(member, 'name');
            const memberDisplay = `${memberName} (${gmeId})`;

            throw new Error(`Cannot delete partial member registry values for ${memberDisplay}`);
        }
    }

};

Importer.prototype._put.registry = function(node, change) {
    const [/*type*/, name] = change.key;
    const keys = change.key.slice(2);
    if (keys.length) {
        const value = this.core.getRegistry(node, name);
        setNested(value, keys, change.value);
        this.core.setRegistry(node, name, value);
    } else {
        this.core.setRegistry(node, name, change.value);
    }
};

Importer.prototype._delete.registry = function(node, change) {
    assert(
        change.key.length === 2,
        `Complex registry values not currently supported: ${change.key.join(', ')}`
    );
    const [/*type*/, name] = change.key;
    this.core.delRegistry(node, name);
};
