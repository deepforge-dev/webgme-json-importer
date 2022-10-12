import {NodeSelections} from './NodeSelectors';
import {NodeChangeSet} from './NodeChangeSet';
import {NodeSearchUtils, setNested} from './Utils';
import {Maybe, Result} from 'ts-monads';
import diff, {ChangeSet, ChangeType} from 'changeset';
import JSONImporter from "../JSONImporter";
import Core = GmeClasses.Core;

type PatchFunction = (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections) => Promise<Result<PatchResult, PatchError>>;
type PatchResultPromise = Promise<Result<PatchResult, PatchError>>;

class PatchResult {
    patches: NodeChangeSet | NodeChangeSet[];

    constructor(patches: NodeChangeSet | NodeChangeSet[]) {
        this.patches = patches;
    }
}

export class PatchError extends Error {
    constructor(msg: string) {
        super(msg);
    }
}

export interface PatchOperation {
    core: GmeClasses.Core;
    put: PatchFunction;
    delete: PatchFunction;
}

export abstract class NodeStatePatch implements PatchOperation {
    core: GmeClasses.Core;
    nodeSearchUtils: NodeSearchUtils

    constructor(core: GmeClasses.Core, nodeSearchUtils: NodeSearchUtils) {
        this.core = core;
        this.nodeSearchUtils = nodeSearchUtils;
    }

    keyLengthValidator(change) {
        return change.key.length === 2;
    }

    abstract delete: PatchFunction;
    abstract put: PatchFunction;
}

export class AttributesPatch extends NodeStatePatch {
    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): PatchResultPromise => {
        const errMsg = `Complex attributes not currently supported: ${change.key.join(', ')}`;
        return change
            .validated(this.keyLengthValidator, errMsg)
            .map(chg => {
                const [/*type*/, name] = chg.key;
                this.core.setAttribute(node, name, chg.value || '');
                return Maybe.fromValue(new PatchResult(chg));
            }).mapError(err => {
                return Maybe.fromValue(new PatchError(err.message));
            });

    };

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        const errMsg = `Complex attributes not currently supported: ${change.key.join(', ')}`;

        return change
            .validated(this.keyLengthValidator, errMsg)
            .map(chg => {
                const [/*type*/, name] = change.key;
                this.core.delAttribute(node, name);
                return Maybe.fromValue(new PatchResult(chg))
            }).mapError(err => {
                return Maybe.fromValue(new PatchError(err.message));
            });
    };
}

export class AttributeMetaPatch extends NodeStatePatch {
    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult()
            .map(chg => {
                const isAttrDeletion = chg.key.length === 2;
                const [/*type*/, name] = chg.key;
                if (isAttrDeletion) {
                    this.core.delAttributeMeta(node, name);
                } else {
                    const meta = this.core.getAttributeMeta(node, name);
                    const metaChange = {type: 'del', key: change.key.slice(2)};
                    const newMeta = diff.apply([metaChange], meta);
                    this.core.setAttributeMeta(node, name, newMeta);
                }
                return Maybe.some(new PatchResult(chg));
            });
    }

    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult()
            .map(chg => {
                const [/*type*/, name] = chg.key;
                const keys = chg.key.slice(2);

                if (keys.length) {
                    const value = this.core.getAttributeMeta(node, name);
                    setNested(value, keys, change.value);
                    this.core.setAttributeMeta(node, name, value);
                } else {
                    this.core.setAttributeMeta(node, name, change.value);
                }

                return Maybe.some(new PatchResult(chg));
            });
    }

}

export class PointersPatch extends NodeStatePatch {
    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        const errMsg = `Invalid key for pointer: ${change.key.slice(1).join(', ')}`;
        return change.validated(this.keyLengthValidator, errMsg).map(chg => {
            const [/*type*/, name] = change.key;
            this.core.delPointer(node, name);
            return Maybe.some(new PatchResult(chg));
        });
    }

    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        const errMsg = `Invalid key for pointer: ${change.key.slice(1).join(', ')}`;
        return await (change.validated(this.keyLengthValidator, errMsg).mapAsync(async chg => {
            const [/*type*/, name] = chg.key;
            let target = null;
            let targetPath = null;
            if (chg.value !== null) {
                target = chg.value !== null ?
                    await this.nodeSearchUtils.getNode(node, chg.value, resolvedSelectors)
                    : null;
                targetPath = this.core.getPath(target);
            }
            const hasChanged = targetPath !== this.core.getPointerPath(node, name);
            if (hasChanged) {
                this.core.setPointer(node, name, target);
            }

            return Maybe.some(new PatchResult(change));
        }));
    }
}

export class GuidPatch extends NodeStatePatch {
    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().map(v => Maybe.some(new PatchResult(v)));
    }

    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().map(chg => {
            const {value} = chg;
            this.core.setGuid(node, value);
            return Maybe.some(new PatchResult(chg));
        });
    }
}

export class MixinsPatch extends NodeStatePatch {
    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().map(chg => {
            const [, index] = chg.key;
            const mixinPath = this.core.getMixinPaths(node)[index];
            this.core.delMixin(node, mixinPath);
            return Maybe.some(new PatchResult(chg));
        });
    };

    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return await change.asResult().mapAsync(async chg => {
            const [, index] = chg.key;
            const oldMixinPath = this.core.getMixinPaths(node)[index];
            if (oldMixinPath) {
                this.core.delMixin(node, oldMixinPath);
            }

            const mixinId = chg.value;

            const mixinPath = await this.nodeSearchUtils.getNodeId(node, mixinId, resolvedSelectors);
            const canSet = this.core.canSetAsMixin(node, mixinPath);
            if (canSet.isOk) {
                this.core.addMixin(node, mixinPath);
                return Maybe.some(new PatchResult(chg));
            } else {
                throw new PatchError(
                    `Cannot set ${mixinId} as mixin for ${this.core.getPath(node)}: ${canSet.reason}`
                );
            }
        });

    };

}

export class PointerMetaPatch extends NodeStatePatch {
    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return (await change.asResult()
            .mapAsync(async chg => {
                const [/*"pointer_meta"*/, name, idOrMinMax] = chg.key;
                const isNewPointer = chg.key.length === 2;

                if (isNewPointer) {
                    const meta = chg.value;
                    this.core.setPointerMetaLimits(node, name, meta.min, meta.max);

                    const targets = Object.entries(chg.value)
                        .filter(pair => {
                            const [key, /*value*/] = pair;
                            return !['min', 'max'].includes(key);
                        });

                    for (let i = targets.length; i--;) {
                        const [nodeId, meta] = targets[i];
                        const target = await this.nodeSearchUtils.getNode(node, nodeId, resolvedSelectors);
                        this.core.setPointerMetaTarget(node, name, target, meta.min, meta.max);
                    }
                } else if (['min', 'max'].includes(idOrMinMax)) {
                    const meta = this.core.getPointerMeta(node, name);
                    meta[idOrMinMax] = chg.value;
                    this.core.setPointerMetaLimits(node, name, meta.min, meta.max);
                } else {
                    const meta = this.core.getPointerMeta(node, name);
                    const target = await this.nodeSearchUtils.getNode(node, idOrMinMax, resolvedSelectors);
                    const gmeId = await this.core.getPath(target);
                    const keys = chg.key.slice(2);
                    keys[0] = gmeId;
                    setNested(meta, keys, chg.value);

                    const targetMeta = meta[gmeId];
                    this.core.setPointerMetaTarget(node, name, target, targetMeta.min, targetMeta.max);
                }

                return Maybe.some(new PatchResult(chg));
            }));

    };

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return await change.asResult().mapAsync(async chg => {
            const [/*type*/, name, targetId] = chg.key;
            const removePointer = targetId === undefined;
            if (removePointer) {
                this.core.delPointerMeta(node, name);
            } else {
                const gmeId = await this.nodeSearchUtils.getNodeId(node, targetId, resolvedSelectors);
                this.core.delPointerMetaTarget(node, name, gmeId);
            }

            return Maybe.some(new PatchResult(chg));
        });

    };
}

export class ChildrenPatch extends NodeStatePatch {
    importer: JSONImporter;

    constructor(core: GmeClasses.Core, nodeSearchUtils: NodeSearchUtils, importer: JSONImporter) {
        super(core, nodeSearchUtils);
        this.importer = importer;
    }

    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return (await change.asResult().mapAsync(async chg => {
            await this.importer.createStateSubTree(change.parentPath, change.value, resolvedSelectors);
            return Maybe.some(new PatchResult(change));
        })).mapError(err => {
            return Maybe.some(err);
        });
    };

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().map(chg => {
            this.core.deleteNode(node);
            return Maybe.some(new PatchResult(chg));
        });
    };
}

export class SetsPatch extends NodeStatePatch {
    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return await change.asResult().mapAsync(async change => {
            const [/*type*/, name] = change.key;
            const isNewSet = change.key.length === 2;
            if (isNewSet) {
                this.core.createSet(node, name);
                const memberPaths = change.value;

                for (let i = 0; i < memberPaths.length; i++) {
                    const member = await this.nodeSearchUtils.getNode(node, memberPaths[i], resolvedSelectors);
                    this.core.addMember(node, name, member);
                }
            } else {
                const member = await this.nodeSearchUtils.getNode(node, change.value, resolvedSelectors);
                this.core.addMember(node, name, member);
            }

            return Maybe.some(new PatchResult(change));
        })

    };

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().map(chg => {
            const [/*type*/, name, index] = change.key;
            const removeSet = index === undefined;
            if (removeSet) {
                this.core.delSet(node, name);
            } else {
                const member = this.core.getMemberPaths(node, name)[index];
                this.core.delMember(node, name, member);
            }
            return Maybe.some(new PatchResult(change));
        });
    };

}

export class MemberAttributesPatch extends NodeStatePatch {
    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
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
                await this.put(node, changesets[i], resolvedSelectors);
            }
        } else {
            const gmeId = await this.nodeSearchUtils.getNodeId(node, nodeId, resolvedSelectors);
            this.core.setMemberAttribute(node, set, gmeId, name, change.value);
        }

        return Result.Ok(new PatchResult(change));
    };

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {

        const [/*type*/, set, nodeId, name] = change.key;
        const gmeId = await this.nodeSearchUtils.getNodeId(node, nodeId, resolvedSelectors);
        const deleteAllAttributes = name === undefined;
        const isMember = this.core.getMemberPaths(node, set).includes(gmeId);
        const validator = chg => isMember;
        return await (change
            .validated(validator, 'Empty')
            .map(chg => {
                const attributeNames = deleteAllAttributes ?
                    this.core.getMemberAttributeNames(node, set, gmeId) : [name];

                attributeNames.forEach(name => {
                    this.core.delMemberAttribute(node, set, gmeId, name);
                });
                return Maybe.some(new PatchResult(chg));
            }))
            .mapErrorAsync(async err => {
                if (deleteAllAttributes) return Maybe.none();
                const member = await this.core.loadByPath(this.nodeSearchUtils.getRoot(), gmeId);
                const memberName = this.core.getAttribute(member, 'name');
                const memberDisplay = `${memberName} (${gmeId})`;

                const newErr = new PatchError(`Cannot delete partial member attributes for ${memberDisplay}`);
                return Maybe.some(newErr);
            });
    }

}


export class MemberRegistryPatch extends NodeStatePatch {
    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        const [/*type*/, set, nodeId, name] = change.key;
        const parent = this.core.getParent(node)
        const parentPath = parent ? this.core.getPath(parent) : '';
        const isNewSet = nodeId === undefined;
        const isNewMember = name === undefined;
        return await change.asResult().mapAsync(async chg => {
            if (isNewSet || isNewMember) {
                const changesets = Object.entries(chg.value)
                    .map(entry => {
                        const changeSet: ChangeSet = ({
                            type: ChangeType.PUT,
                            key: chg.key.concat([entry[0]]),
                            value: entry[1],
                        });
                        return NodeChangeSet.fromChangeSet(parentPath, nodeId, changeSet);
                    });

                for (let i = changesets.length; i--;) {
                    await this.put(node, changesets[i], resolvedSelectors);
                }
            } else {
                const gmeId = await this.nodeSearchUtils.getNodeId(node, nodeId, resolvedSelectors);
                const isNested = chg.key.length > 4;
                if (isNested) {
                    const value = this.core.getMemberRegistry(node, set, gmeId, name);
                    setNested(value, chg.key.slice(4), chg.value);
                    this.core.setMemberRegistry(node, set, gmeId, name, value);
                } else {
                    this.core.setMemberRegistry(node, set, gmeId, name, chg.value);
                }
            }
            return Maybe.some(new PatchResult(chg));
        });

    }

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return await change.asResult().mapAsync(async chg => {
            const [/*type*/, set, nodeId, name] = chg.key;
            const gmeId = await this.nodeSearchUtils.getNodeId(node, nodeId, resolvedSelectors);
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
                    const member = await this.core.loadByPath(this.nodeSearchUtils.getRoot(), gmeId);
                    const memberName = this.core.getAttribute(member, 'name');
                    const memberDisplay = `${memberName} (${gmeId})`;

                    throw new PatchError(`Cannot delete partial member registry values for ${memberDisplay}`);
                }
            }
            return Maybe.some(new PatchResult(chg));
        });
    }
}

export class RegistryPatch extends NodeStatePatch {
    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().map(chg => {
            const [/*type*/, name] = change.key;
            const keys = change.key.slice(2);
            if (keys.length) {
                const value = this.core.getRegistry(node, name);
                setNested(value, keys, change.value);
                this.core.setRegistry(node, name, value);
            } else {
                this.core.setRegistry(node, name, change.value);
            }
            return Maybe.some(new PatchResult(chg));
        });
    };

    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        const errMsg = `Complex registry values not currently supported: ${change.key.join(', ')}`;
        return change.validated(this.keyLengthValidator, errMsg).map(chg => {
            const [/*type*/, name] = change.key;
            this.core.delRegistry(node, name);
            return Maybe.some(new PatchResult(change));
        }).mapError(err => {
            return Maybe.some(new PatchError(err.message));
        });
    };
}


export class ChildrenMetaPatch extends NodeStatePatch {
    delete = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().mapAsync(async chg => {
            const [/*"children_meta"*/, idOrMinMax] = chg.key;
            const isNodeId = !['min', 'max'].includes(idOrMinMax);
            if (isNodeId) {
                const gmeId = await this.nodeSearchUtils.getNodeId(node, idOrMinMax, resolvedSelectors);
                this.core.delChildMeta(node, gmeId);
            }

            return Maybe.some(new PatchResult(chg));
        });
    }

    put = async (node: Core.Node, change: NodeChangeSet, resolvedSelectors: NodeSelections): Promise<Result<PatchResult, PatchError>> => {
        return change.asResult().mapAsync(async chg => {
            const [/*"children_meta"*/, idOrUndef] = chg.key;
            const isAddingContainment = !idOrUndef;
            const isNewChildDefinition = typeof idOrUndef === 'string';
            if (isAddingContainment) {
                const {min, max} = chg.value;
                this.core.setChildrenMetaLimits(node, min, max);
                const childEntries = Object.entries(chg.value).filter(pair => !['min', 'max'].includes(pair[0]));
                for (let i = 0; i < childEntries.length; i++) {
                    const [nodeId, {min, max}] = childEntries[i];
                    const childNode = await this.nodeSearchUtils.getNode(node, nodeId, resolvedSelectors);
                    this.core.setChildMeta(node, childNode, min, max);
                    this.core.setChildMeta(node, childNode, min, max);
                }
            } else if (isNewChildDefinition) {
                const nodeId = idOrUndef;
                const {min, max} = chg.value;
                const childNode = await this.nodeSearchUtils.getNode(node, nodeId, resolvedSelectors);
                this.core.setChildMeta(node, childNode, min, max);
            }

            return Maybe.some(new PatchResult(chg));
        });

    }
}
