import { NodeSelections } from './NodeSelectors';
import { NodeChangeSet } from './NodeChangeSet';
import { NodeSearchUtils, setNested } from './Utils';
import { Ok, Err } from 'ts-monads';
import { Result } from 'ts-monads/lib/Result';
import diff, { ChangeSet, ChangeType } from 'changeset';
import JSONImporter from '../JSONImporter';
import NodeState from './NodeState';

type PatchResultType = Result<PatchInfo, PatchError>;
type PatchResultPromise = Promise<PatchResultType>;
type PatchFunction = (
    node: Core.Node,
    change: NodeChangeSet,
    resolvedSelectors: NodeSelections
) => Promise<void>;

class PatchInfo {
    nodeId: GmeCommon.Path;
    nodeGuid: Core.GUID;
    target: keyof NodeState;
    appliedPatch: ChangeSet;

    constructor(
        nodeId: GmeCommon.Path,
        nodeGuid: Core.GUID,
        target: keyof NodeState,
        appliedPatch: ChangeSet
    ) {
        this.nodeGuid = nodeGuid;
        this.nodeId = nodeId;
        this.target = target;
        this.appliedPatch = appliedPatch;
    }

    static create(
        core: GmeClasses.Core,
        node: Core.Node,
        nodeChangeSet: NodeChangeSet
    ) {
        const nodeGuid = core.getGuid(node);
        const nodePath = core.getPath(node);
        const [target] = nodeChangeSet.key as keyof NodeState;

        const { key, type, value } = nodeChangeSet;

        return new PatchInfo(nodePath, nodeGuid, target, { key, type, value });
    }
}

export class PatchError extends Error {
    constructor(msg: string) {
        super(msg);
    }
}

export interface PatchOperation {
    core: GmeClasses.Core;
    put: (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ) => PatchResultPromise;
    delete: (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ) => PatchResultPromise;
}

export abstract class NodeStatePatch implements PatchOperation {
    core: GmeClasses.Core;
    nodeSearchUtils: NodeSearchUtils;

    constructor(core: GmeClasses.Core, nodeSearchUtils: NodeSearchUtils) {
        this.core = core;
        this.nodeSearchUtils = nodeSearchUtils;
    }

    keyLengthValidator(change) {
        return change.key.length === 2;
    }

    async put(
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): PatchResultPromise {
        return (
            await this._validChangePut(change).mapAsync(
                async (validChange) =>
                    await this._put(node, change, resolvedSelectors)
            )
        ).map((res) => this.createPatchInfo(node, change));
    }

    async delete(
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): PatchResultPromise {
        return (
            await this._validChangeDelete(change).mapAsync(
                async (validChange) =>
                    await this._delete(node, change, resolvedSelectors)
            )
        ).map((res) => this.createPatchInfo(node, change));
    }

    async createPatchInfo(node, change) {
        const [target] = change.key;
        if (target === 'children') {
            const node = await this.core.loadByPath(
                this.nodeSearchUtils.getRoot(),
                change.parentPath
            );
            return PatchInfo.create(this.core, node, change);
        }
        return PatchInfo.create(this.core, node, change);
    }

    _validChangePut(
        change: NodeChangeSet
    ): Ok<NodeChangeSet> | Err<PatchError> {
        return new Ok<NodeChangeSet>(change); // override this as needed in child classes
    }

    _validChangeDelete(
        change: NodeChangeSet
    ): Ok<NodeChangeSet> | Err<PatchError> {
        return new Ok<NodeChangeSet>(change); // override this as needed in child classes
    }

    abstract _delete: PatchFunction;
    abstract _put: PatchFunction;
}

export class AttributesPatch extends NodeStatePatch {
    _validChangePut(
        change: NodeChangeSet
    ): Ok<NodeChangeSet> | Err<PatchError> {
        if (change.key.length === 2) {
            return new Ok(change);
        }
        const msg = `Complex attributes not currently supported: ${change.key.join(
            ', '
        )}`;
        return new Err(new PatchError(msg));
    }

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        this.core.setAttribute(node, name, change.value || '');
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        this.core.delAttribute(node, name);
    };
}

export class AttributeMetaPatch extends NodeStatePatch {
    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const isAttrDeletion = change.key.length === 2;
        const [, /*type*/ name] = change.key;
        if (isAttrDeletion) {
            this.core.delAttributeMeta(node, name);
        } else {
            const meta = this.core.getAttributeMeta(node, name);
            const metaChange = { type: 'del', key: change.key.slice(2) };
            const newMeta = diff.apply([metaChange], meta);
            this.core.setAttributeMeta(node, name, newMeta);
        }
    };

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        const keys = change.key.slice(2);

        if (keys.length) {
            const value = this.core.getAttributeMeta(node, name);
            setNested(value, keys, change.value);
            this.core.setAttributeMeta(node, name, value);
        } else {
            this.core.setAttributeMeta(node, name, change.value);
        }
    };
}

export class PointersPatch extends NodeStatePatch {
    _validChangePut(
        change: NodeChangeSet
    ): Ok<NodeChangeSet> | Err<PatchError> {
        const errMsg = `Invalid key for pointer: ${change.key
            .slice(1)
            .join(', ')}`;
        if (this.keyLengthValidator(change)) {
            return new Ok(change);
        } else {
            return new Err(new PatchError(errMsg));
        }
    }

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        this.core.delPointer(node, name);
    };

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        let target = null;
        let targetPath = null;
        if (change.value !== null) {
            target =
                change.value !== null
                    ? await this.nodeSearchUtils.getNode(
                          node,
                          change.value,
                          resolvedSelectors
                      )
                    : null;
            targetPath = this.core.getPath(target);
        }
        const hasChanged = targetPath !== this.core.getPointerPath(node, name);
        if (hasChanged) {
            this.core.setPointer(node, name, target);
        }
    };
}

export class GuidPatch extends NodeStatePatch {
    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {};

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const { value } = change;
        await this.core.setGuid(node, value);
    };
}

export class MixinsPatch extends NodeStatePatch {
    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, index] = change.key;
        const mixinPath = this.core.getMixinPaths(node)[index];
        this.core.delMixin(node, mixinPath);
    };

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, index] = change.key;
        const oldMixinPath = this.core.getMixinPaths(node)[index];
        if (oldMixinPath) {
            this.core.delMixin(node, oldMixinPath);
        }

        const mixinId = change.value;

        const mixinPath = await this.nodeSearchUtils.getNodeId(
            node,
            mixinId,
            resolvedSelectors
        );
        const canSet = this.core.canSetAsMixin(node, mixinPath);
        if (canSet.isOk) {
            this.core.addMixin(node, mixinPath);
        } else {
            throw new PatchError(
                `Cannot set ${mixinId} as mixin for ${this.core.getPath(
                    node
                )}: ${canSet.reason}`
            );
        }
    };
}

export class PointerMetaPatch extends NodeStatePatch {
    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*"pointer_meta"*/ name, idOrMinMax] = change.key;
        const isNewPointer = change.key.length === 2;

        if (isNewPointer) {
            const meta = change.value;
            this.core.setPointerMetaLimits(node, name, meta.min, meta.max);

            const targets = Object.entries(change.value).filter((pair) => {
                const [key /*value*/] = pair;
                return !['min', 'max'].includes(key);
            });

            for (let i = targets.length; i--; ) {
                const [nodeId, meta] = targets[i];
                const target = await this.nodeSearchUtils.getNode(
                    node,
                    nodeId,
                    resolvedSelectors
                );
                this.core.setPointerMetaTarget(
                    node,
                    name,
                    target,
                    meta.min,
                    meta.max
                );
            }
        } else if (['min', 'max'].includes(idOrMinMax)) {
            const meta = this.core.getPointerMeta(node, name);
            meta[idOrMinMax] = change.value;
            this.core.setPointerMetaLimits(node, name, meta.min, meta.max);
        } else {
            const meta = this.core.getPointerMeta(node, name);
            const target = await this.nodeSearchUtils.getNode(
                node,
                idOrMinMax,
                resolvedSelectors
            );
            const gmeId = await this.core.getPath(target);
            const keys = change.key.slice(2);
            keys[0] = gmeId;
            setNested(meta, keys, change.value);

            const targetMeta = meta[gmeId];
            this.core.setPointerMetaTarget(
                node,
                name,
                target,
                targetMeta.min,
                targetMeta.max
            );
        }
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name, targetId] = change.key;
        const removePointer = targetId === undefined;
        if (removePointer) {
            this.core.delPointerMeta(node, name);
        } else {
            const gmeId = await this.nodeSearchUtils.getNodeId(
                node,
                targetId,
                resolvedSelectors
            );
            this.core.delPointerMetaTarget(node, name, gmeId);
        }
    };
}

export class ChildrenPatch extends NodeStatePatch {
    importer: JSONImporter;

    constructor(
        core: GmeClasses.Core,
        nodeSearchUtils: NodeSearchUtils,
        importer: JSONImporter
    ) {
        super(core, nodeSearchUtils);
        this.importer = importer;
    }

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        await this.importer.createStateSubTree(
            change.parentPath,
            change.value,
            resolvedSelectors
        );
        const parent = await this.core.loadByPath(
            this.nodeSearchUtils.getRoot(),
            change.parentPath
        );
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        this.core.deleteNode(node);
    };
}

export class SetsPatch extends NodeStatePatch {
    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        const isNewSet = change.key.length === 2;
        if (isNewSet) {
            this.core.createSet(node, name);
            const memberPaths = change.value;

            for (let i = 0; i < memberPaths.length; i++) {
                const member = await this.nodeSearchUtils.getNode(
                    node,
                    memberPaths[i],
                    resolvedSelectors
                );
                this.core.addMember(node, name, member);
            }
        } else {
            const member = await this.nodeSearchUtils.getNode(
                node,
                change.value,
                resolvedSelectors
            );
            this.core.addMember(node, name, member);
        }
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name, index] = change.key;
        const removeSet = index === undefined;
        if (removeSet) {
            this.core.delSet(node, name);
        } else {
            const member = this.core.getMemberPaths(node, name)[index];
            this.core.delMember(node, name, member);
        }
    };
}

export class MemberAttributesPatch extends NodeStatePatch {
    async _deletionInfo(node, change, resolvedSelectors) {
        const [, /*type*/ set, nodeId, name] = change.key;
        const gmeId = await this.nodeSearchUtils.getNodeId(
            node,
            nodeId,
            resolvedSelectors
        );
        const deleteAllAttributes = name === undefined;
        const isMember = this.core.getMemberPaths(node, set).includes(gmeId);
        return {
            isMember,
            deleteAllAttributes,
            gmeId,
            set,
            nodeId,
            name,
        };
    }

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ set, nodeId, name] = change.key;
        const isNewSet = nodeId === undefined;
        const isNewMember = name === undefined;
        if (isNewSet || isNewMember) {
            const changesets = Object.entries(change.value).map((entry) => ({
                type: 'put',
                key: change.key.concat([entry[0]]),
                value: entry[1],
            }));

            for (let i = changesets.length; i--; ) {
                await this.put(node, changesets[i], resolvedSelectors);
            }
        } else {
            const gmeId = await this.nodeSearchUtils.getNodeId(
                node,
                nodeId,
                resolvedSelectors
            );
            this.core.setMemberAttribute(node, set, gmeId, name, change.value);
        }
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const { isMember, deleteAllAttributes, gmeId, set, name } =
            await this._deletionInfo(node, change, resolvedSelectors);
        if (isMember) {
            const attributeNames = deleteAllAttributes
                ? this.core.getMemberAttributeNames(node, set, gmeId)
                : [name];

            attributeNames.forEach((name) => {
                this.core.delMemberAttribute(node, set, gmeId, name);
            });
        } else {
            if (!deleteAllAttributes) {
                const member = await this.core.loadByPath(
                    this.nodeSearchUtils.getRoot(),
                    gmeId
                );
                const memberName = this.core.getAttribute(member, 'name');
                const memberDisplay = `${memberName} (${gmeId})`;

                throw new PatchError(
                    `Cannot delete partial member attributes for ${memberDisplay}`
                );
            }
        }
    };
}

export class MemberRegistryPatch extends NodeStatePatch {
    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ set, nodeId, name] = change.key;
        const parent = this.core.getParent(node);
        const parentPath = parent ? this.core.getPath(parent) : '';
        const isNewSet = nodeId === undefined;
        const isNewMember = name === undefined;
        if (isNewSet || isNewMember) {
            const changesets = Object.entries(change.value).map((entry) => {
                const changeSet: ChangeSet = {
                    type: ChangeType.PUT,
                    key: change.key.concat([entry[0]]),
                    value: entry[1],
                };
                return NodeChangeSet.fromChangeSet(
                    parentPath,
                    nodeId,
                    changeSet
                );
            });

            for (let i = changesets.length; i--; ) {
                await this.put(node, changesets[i], resolvedSelectors);
            }
        } else {
            const gmeId = await this.nodeSearchUtils.getNodeId(
                node,
                nodeId,
                resolvedSelectors
            );
            const isNested = change.key.length > 4;
            if (isNested) {
                const value = this.core.getMemberRegistry(
                    node,
                    set,
                    gmeId,
                    name
                );
                setNested(value, change.key.slice(4), change.value);
                this.core.setMemberRegistry(node, set, gmeId, name, value);
            } else {
                this.core.setMemberRegistry(
                    node,
                    set,
                    gmeId,
                    name,
                    change.value
                );
            }
        }
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ set, nodeId, name] = change.key;
        const gmeId = await this.nodeSearchUtils.getNodeId(
            node,
            nodeId,
            resolvedSelectors
        );
        const deleteAllRegistryValues = name === undefined;
        const isMember = this.core.getMemberPaths(node, set).includes(gmeId);
        if (isMember) {
            const attributeNames = deleteAllRegistryValues
                ? this.core.getMemberRegistryNames(node, set, gmeId)
                : [name];

            attributeNames.forEach((name) => {
                this.core.delMemberRegistry(node, set, gmeId, name);
            });
        } else {
            if (!deleteAllRegistryValues) {
                const member = await this.core.loadByPath(
                    this.nodeSearchUtils.getRoot(),
                    gmeId
                );
                const memberName = this.core.getAttribute(member, 'name');
                const memberDisplay = `${memberName} (${gmeId})`;

                throw new PatchError(
                    `Cannot delete partial member registry values for ${memberDisplay}`
                );
            }
        }
    };
}

export class RegistryPatch extends NodeStatePatch {
    _validChangeDelete(
        change: NodeChangeSet
    ): Ok<NodeChangeSet> | Err<PatchError> {
        if (this.keyLengthValidator(change)) {
            return new Ok(change);
        } else {
            const errMsg = `Complex registry values not currently supported: ${change.key.join(
                ', '
            )}`;
            return new Err(new PatchError(errMsg));
        }
    }

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        const keys = change.key.slice(2);
        if (keys.length) {
            const value = this.core.getRegistry(node, name);
            setNested(value, keys, change.value);
            this.core.setRegistry(node, name, value);
        } else {
            this.core.setRegistry(node, name, change.value);
        }
    };

    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*type*/ name] = change.key;
        this.core.delRegistry(node, name);
    };
}

export class ChildrenMetaPatch extends NodeStatePatch {
    _delete = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*"children_meta"*/ idOrMinMax] = change.key;
        const isNodeId = !['min', 'max'].includes(idOrMinMax);
        if (isNodeId) {
            const gmeId = await this.nodeSearchUtils.getNodeId(
                node,
                idOrMinMax,
                resolvedSelectors
            );
            this.core.delChildMeta(node, gmeId);
        }
    };

    _put = async (
        node: Core.Node,
        change: NodeChangeSet,
        resolvedSelectors: NodeSelections
    ): Promise<void> => {
        const [, /*"children_meta"*/ idOrUndef] = change.key;
        const isAddingContainment = !idOrUndef;
        const isNewChildDefinition = typeof idOrUndef === 'string';
        if (isAddingContainment) {
            const { min, max } = change.value;
            this.core.setChildrenMetaLimits(node, min, max);
            const childEntries = Object.entries(change.value).filter(
                (pair) => !['min', 'max'].includes(pair[0])
            );
            for (let i = 0; i < childEntries.length; i++) {
                const [nodeId, { min, max }] = childEntries[i];
                const childNode = await this.nodeSearchUtils.getNode(
                    node,
                    nodeId,
                    resolvedSelectors
                );
                this.core.setChildMeta(node, childNode, min, max);
                this.core.setChildMeta(node, childNode, min, max);
            }
        } else if (isNewChildDefinition) {
            const nodeId = idOrUndef;
            const { min, max } = change.value;
            const childNode = await this.nodeSearchUtils.getNode(
                node,
                nodeId,
                resolvedSelectors
            );
            this.core.setChildMeta(node, childNode, min, max);
        }
    };
}
