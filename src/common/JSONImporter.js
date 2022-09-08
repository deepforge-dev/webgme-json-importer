/*globals define*/

define([
    './changeset',
], function(
    diff,
) {
    const Constants = {
        META_ASPECT_SET_NAME: 'MetaAspectSet',
    };

    class Importer {
        constructor(core, rootNode) {
            this.core = core;
            this.rootNode = rootNode;
            this._nodeIDCounter = 1;
        }

        async _metaDictToGuids(meta_dict){
            if (meta_dict === null) return meta_dict;
            return Object.fromEntries(
                await Promise.all(Object.entries(meta_dict).map(async ([key, value]) => {
                    if (key === 'min' || key === 'max') return [key, value];
                    const node = await this.core.loadByPath(this.rootNode, key);
                    return [this.core.getGuid(node), value];
                }))
            );
        }

        async toJSON(node, omit=new OmittedProperties()) {
            if(typeof omit === 'boolean') {
                const omitList = omit ? ['children'] : [];
                omit = new OmittedProperties(omitList);
            } // Backwards compatible with shallow

            return await this._toJSON(node, omit);
        }

        async _toJSON(node, toOmit) {
            const json = {
                id: this.core.getGuid(node),
                path: this.core.getPath(node),
                guid: this.core.getGuid(node),
                attributes: {},
                attribute_meta: {},
                pointers: {},
                pointer_meta: {},
                mixins: [],
                registry: {},
                sets: {},
                member_attributes: {},
                member_registry: {},
                children: [],
                children_meta: {},
            };

            toOmit.forEach(prop => delete json[prop]);

            const exporters = {
                attributes: (node, json, /*promiseQueue*/) => {
                    this.core.getOwnAttributeNames(node).forEach(name => {
                        json.attributes[name] = this.core.getAttribute(node, name);
                    });
                },

                attribute_meta: (node, json, /*promiseQueue*/) => {
                    this.core.getOwnValidAttributeNames(node).forEach(name => {
                        json.attribute_meta[name] = this.core.getAttributeMeta(node, name);
                    });
                },

                pointers: (node, json, promiseQueue) => {
                    promiseQueue.push(...this.core.getOwnPointerNames(node).map(async name => {
                        const path = this.core.getPointerPath(node, name);
                        if (path) {
                            const target = await this.core.loadByPath(this.rootNode, path);
                            json.pointers[name] = this.core.getGuid(target);
                        } else {
                            json.pointers[name] = path;
                        }
                    }));
                    const baseNode = this.core.getBase(node);
                    json.pointers.base = baseNode && this.core.getGuid(baseNode);
                },

                mixins: (node, json, /*promiseQueue*/) => {
                    json.mixins = Object.values(this.core.getMixinNodes(node)).map(node => this.core.getGuid(node));
                },

                pointer_meta: (node, json, promiseQueue) => {
                    promiseQueue.push(...this.core.getOwnValidPointerNames(node).map(async name => {
                        const ptr_meta = this.core.getPointerMeta(node, name);
                        json.pointer_meta[name] = await this._metaDictToGuids(ptr_meta);
                    }));
                },

                registry: (node, json, /*promiseQueue*/) => {
                    this.core.getOwnRegistryNames(node).forEach(name => {
                        json.registry[name] = this.core.getRegistry(node, name);
                    });
                },

                sets: (node, json, promiseQueue) => {
                    promiseQueue.push(...this.core.getOwnSetNames(node)
                        .filter(name => name !== '_mixins')
                        .map(async name => {
                            const paths = this.core.getMemberPaths(node, name);
                            const members = await Promise.all(paths.map(path => this.core.loadByPath(this.rootNode, path)));
                            const memberGuids = members.map(member => this.core.getGuid(member));
                            json.sets[name] = memberGuids;

                            if (!toOmit.has('member_attributes')) { // Alternatives to this closure variable?
                                members.forEach(member => {
                                    let guid = this.core.getGuid(member);
                                    let memberPath = this.core.getPath(member);

                                    json.member_attributes[name] = {};
                                    json.member_attributes[name][guid] = {};
                                    this.core.getMemberAttributeNames(node, name, memberPath).forEach(attrName => {
                                        const value = this.core.getMemberAttribute(node, name, memberPath, attrName);
                                        json.member_attributes[name][guid][attrName] = value;
                                    });
                                });
                            }
                            if (!toOmit.has('member_registry')) {
                                members.forEach(member => {
                                    let guid = this.core.getGuid(member);
                                    let memberPath = this.core.getPath(member);

                                    json.member_registry[name] = {};
                                    json.member_registry[name][guid] = {};
                                    this.core.getMemberRegistryNames(node, name, memberPath).forEach(regName => {
                                        const value = this.core.getMemberRegistry(node, name, memberPath, regName);
                                        json.member_registry[name][guid][regName] = value;
                                    });
                                });
                            }

                        }));
                },

                children: (node, json, promiseQueue) => {
                    promiseQueue.push((async () => {
                        json.children = [];
                        const children = await this.core.loadChildren(node);
                        json.children = await Promise.all(children.map(async child => await this._toJSON(child, toOmit)));
                    })());
                },

                children_meta: (node, json, promiseQueue) => {
                    promiseQueue.push(
                        this._metaDictToGuids(this.core.getChildrenMeta(node))
                            .then(children_meta => json.children_meta = children_meta)
                    );
                }
            };

            const asyncTasks = [];
            Object.keys(json).forEach(key => {
                if(exporters[key]) {
                    exporters[key](node, json, asyncTasks);
                }
            });

            await Promise.all(asyncTasks);
            return json;
        }

        async apply (node, state, resolvedSelectors=new NodeSelections()) {
            await this.resolveSelectors(node, state, resolvedSelectors);

            const children = state.children || [];
            const currentChildren = await this.core.loadChildren(node);

            for (let i = 0; i < children.length; i++) {
                const idString = children[i].id;
                const child = await this.findNode(node, idString, resolvedSelectors);
                const index = currentChildren.indexOf(child);
                if (index > -1) {
                    currentChildren.splice(index, 1);
                }

                await this.apply(child, children[i], resolvedSelectors);
            }

            const current = await this.toJSON(node);
            const changes = compare(current, state);
            const keyOrder = [
                'children_meta',
                'pointer_meta',
                'pointers',
                'mixins',
                'sets',
                'member_attributes',
                'member_registry',
            ];
            const singleKeyFields = ['children_meta', 'guid'];
            const sortedChanges = changes
                .filter(
                    change => change.key.length > 1 ||
                        (singleKeyFields.includes(change.key[0]) && change.type === 'put')
                )
                .map((change, index) => {
                    let order = 2 * keyOrder.indexOf(change.key[0]);
                    if (change.type === 'put') {
                        order += 1;
                    }
                    return [order, index];
                })
                .sort((p1, p2) => p1[0] - p2[0])
                .map(pair => changes[pair[1]]);

            for (let i = 0; i < sortedChanges.length; i++) {
                if (sortedChanges[i].type === 'put') {
                    await this._put(node, sortedChanges[i], resolvedSelectors);
                } else if (sortedChanges[i].type === 'del') {
                    await this._delete(node, sortedChanges[i], resolvedSelectors);
                }
            }

            if (state.children) {
                for (let i = currentChildren.length; i--;) {
                    this.core.deleteNode(currentChildren[i]);
                }
            }
        }

        async resolveSelector(node, state, resolvedSelectors) {
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

        async tryResolveSelectors(stateNodePairs, resolvedSelectors) {
            let tryResolveMore = true;
            while (tryResolveMore) {
                tryResolveMore = false;
                for (let i = stateNodePairs.length; i--;) {
                    const [state, parentNode] = stateNodePairs[i];
                    let child = await this.findNode(parentNode, state.id, resolvedSelectors);
                    //const canCreate = !state.id;
                    if (!child /*&& canCreate*/) {
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

                    if (child) {
                        this.resolveSelector(child, state, resolvedSelectors);
                        const pairs = this.getChildStateNodePairs(child, state);
                        stateNodePairs.splice(i, 1, ...pairs);
                        tryResolveMore = true;
                    }
                }
            }

            if (stateNodePairs.length) {
                throw new Error('Cannot resolve all node selectors (circular references)');
            }
        }

        async resolveSelectors(node, state, resolvedSelectors) {
            const parent = this.core.getParent(node);

            if (state.id && parent) {
                this.resolveSelector(node, state, resolvedSelectors);
            }

            const stateNodePairs = this.getChildStateNodePairs(node, state);
            await this.tryResolveSelectors(stateNodePairs, resolvedSelectors);
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
            if (change.key.length > 1) {
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
        this.core.setAttribute(node, name, change.value);
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

    function omit(obj, keys) {
        const result = Object.assign({}, obj);
        keys.forEach(key => delete result[key]);
        return result;
    }

    function compare(obj, obj2, ignore=['id', 'children']) {
        return diff(
            omit(obj, ignore),
            omit(obj2, ignore),
        );
    }

    function assert(cond, msg='ASSERT failed') {
        if (!cond) {
            throw new Error(msg);
        }
    }

    function setNested(object, keys, value) {
        let current = object;
        while (keys.length > 1) {
            current = current[keys.shift()];
        }
        current[keys.shift()] = value;
        return object;
    }

    class NodeSelector {
        constructor(idString='') {
            if (idString.startsWith('/')) {
                this.tag = '@path';
                this.value = idString;
            } else if (idString.startsWith('@')) {
                const data = idString.split(':');
                const tag = data[0];
                if (tag === '@name') {
                    data.splice(0, 1, '@attribute', 'name');
                }
                this.tag = data.shift();
                if (data.length === 1) {
                    this.value = data.shift();
                } else {
                    this.value = [data[0], data.slice(1).join(':')];
                }
            } else {
                this.tag = '@guid';
                this.value = idString;
            }
        }

        prepareCreateParams(params) {
            if (this.tag === '@guid') {
                params.guid = this.value;
            }

            if (this.tag === '@path') {
                params.relid = this.value.split('/').pop();
            }
            return params;
        }

        async prepare(core, rootNode, node) {
            if (this.tag === '@attribute') {
                const [attr, value] = this.value;
                core.setAttribute(node, attr, value);
            }

            if (this.tag === '@meta') {
                core.setAttribute(node, 'name', this.value);

                const metaSheetSet = core.getSetNames(rootNode)
                    .find(name => name !== Constants.META_ASPECT_SET_NAME && name.startsWith(Constants.META_ASPECT_SET_NAME));

                core.addMember(rootNode, Constants.META_ASPECT_SET_NAME, node);
                core.addMember(rootNode, metaSheetSet, node);

                const meta = await core.getAllMetaNodes(rootNode);
                assert(meta[core.getPath(node)], 'New node not in the meta');
            }
        }

        async findNode(core, rootNode, parent, nodeCache) {
            if (this.tag === '@path') {
                return await core.loadByPath(rootNode, this.value);
            }

            if (this.tag === '@meta') {
                const metanodes = Object.values(core.getAllMetaNodes(rootNode));
                const libraries = core.getLibraryNames(rootNode)
                    .map(name => [
                        core.getPath(core.getLibraryRoot(rootNode, name)),
                        name,
                    ]);

                function getFullyQualifiedName(node) {
                    const name = core.getAttribute(node, 'name');
                    const path = core.getPath(node);
                    const libraryPair = libraries.find(([rootPath,]) => path.startsWith(rootPath));
                    if (libraryPair) {
                        const [,libraryName] = libraryPair;
                        return libraryName + '.' + name;
                    }
                    return name;
                }

                return metanodes
                    .find(child => {
                        const name = core.getAttribute(child, 'name');
                        const fullName = getFullyQualifiedName(child);
                        return name === this.value || fullName === this.value;
                    });
            }

            if (this.tag === '@attribute') {
                const [attr, value] = this.value;
                const children = await core.loadChildren(parent);
                return children
                    .find(child => core.getAttribute(child, attr) === value);
            }

            if (this.tag === '@id' || this.tag === '@internal') {
                return null;
            }

            if (this.tag === '@guid') {
                const getCacheKey = node => new NodeSelector(`@guid:${core.getGuid(node)}`);
                const opts = (new NodeSearchOpts())
                    .withCache(
                        nodeCache,
                        getCacheKey
                    )
                    .firstCheck(parent);

                return await this.nodeSearch(
                    core,
                    rootNode,
                    node => core.getGuid(node) === this.value,
                    opts,
                );
            }

            throw new Error(`Unknown tag: ${this.tag}`);
        }

        async nodeSearch(core, node, fn, searchOpts = new NodeSearchOpts()) {
            if (searchOpts.cache && searchOpts.cacheKey) {
                const {cache, cacheKey} = searchOpts;
                const checkNode = fn;
                fn = node => {
                    if (checkNode(node)) {
                        return true;
                    } else {
                        const key = cacheKey(node);
                        const parent = core.getParent(node);
                        if (parent) {
                            cache.record(core.getPath(parent), key, node);
                        }
                    }
                };
            }

            let skipNodes = [];
            if (searchOpts.startHint) {
                let startNode = searchOpts.startHint;
                let match = null;
                while (startNode) {
                    match = await this.findNodeWhere(core, startNode, fn, skipNodes);
                    if (match) {
                        return match;
                    }
                    skipNodes.push(startNode);
                    startNode = core.getParent(startNode);
                }
            }

            return await this.findNodeWhere(core, node, fn, skipNodes);
        }

        async cachedSearch(core, node, fn, cacheKey, nodeCache) {
            return await this.findNodeWhere(
                core,
                node,
                node => {
                    if (fn(node)) {
                        return true;
                    } else {
                        const key = cacheKey(node);
                        const parent = core.getParent(node);
                        if (parent) {
                            nodeCache.record(core.getPath(parent), key, node);
                        }
                    }
                },
            );
        }

        async findNodeWhere(core, node, fn, skipNodes = []) {
            if (skipNodes.includes(node)) {
                return;
            }

            if (await fn(node)) {
                return node;
            }

            const children = await core.loadChildren(node);
            for (let i = 0; i < children.length; i++) {
                const match = await this.findNodeWhere(core, children[i], fn, skipNodes);
                if (match) {
                    return match;
                }
            }
        }

        toString() {
            const data = Array.isArray(this.value) ? this.value : [this.value];
            return [this.tag, ...data].join(':');
        }

        isAbsolute() {
            return this.tag === '@meta' || this.tag === '@path' ||
                this.tag === '@id' || this.tag === '@guid' || this.tag === '@internal';
        }
    }

    class NodeSelections {
        constructor(withCache=true) {
            this.selections = {};
            if (withCache) {
                this.cache = new NodeCache(1000);
            }
        }

        getAbsoluteTag(parentId, selector) {
            let absTag = selector.toString();
            if (!selector.isAbsolute()) {
                absTag = parentId + ':' + absTag;
            }
            return absTag;
        }

        record(parentId, selector, node) {
            const absTag = this.getAbsoluteTag(parentId, selector);
            this.selections[absTag] = node;
        }

        get(parentId, selector) {
            const cachedValue = this.cache?.get(parentId, selector);
            if (cachedValue) return cachedValue;
            return this.selections[this.getAbsoluteTag(parentId, selector)];
        }
    }

    class NodeCache extends NodeSelections {
        constructor(maxSize) {
            super(false);
            this.maxSize = maxSize;
            this.length = 0;
        }

        record(parentId, selector, node) {
            if (this.length < this.maxSize) {
                super.record(parentId, selector, node);
                this.length++;
            }
        }

        get(parentId, selector) {
            const value = super.get(parentId, selector);
            if (value) {
                this.remove(parentId, selector);
            }
            return value;
        }

        remove(parentId, selector) {
            const absTag = this.getAbsoluteTag(parentId, selector);
            delete this.selections[absTag];
            this.length--;
        }
    }

    class NodeSearchOpts {
        constructor() {
            this.cache = null;
            this.startHint = null;
            this.cacheKey = null;
        }

        firstCheck(startNode) {
            this.startHint = startNode;
            return this;
        }

        withCache(cache, cacheKey) {
            this.cache = cache;
            this.cacheKey = cacheKey;
            return this;
        }
    }

    const RELATED_PROPERTIES = {
        sets: ['member_attributes', 'member_registry'],
        children: ['children_meta'],
        attributes: ['attributes_meta'],
        pointers: ['pointer_meta'],
    };
    const INVALID_PROPS = ['id', 'guid', 'path'];
    class OmittedProperties extends Set {
        constructor(...args) {
            super(...args);
            const invalidProperties = INVALID_PROPS.filter(prop => this.has(prop));

            if(invalidProperties.length) {
                throw new Error(`Invalid properties to omit: ${invalidProperties.join(', ')}`);
            }
        }

        withRelatedProperties() {
            const relatedProps = Object.keys(RELATED_PROPERTIES)
                .filter(key => this.has(key))
                .flatMap(key => RELATED_PROPERTIES[key]);

            relatedProps.forEach(dep => this.add(dep));
            return this;
        }
    }

    Importer.NodeSelector = NodeSelector;
    Importer.NodeSelections = NodeSelections;
    Importer.OmittedProperties = OmittedProperties;
    return Importer;
});
