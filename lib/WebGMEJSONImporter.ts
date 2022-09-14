/// <reference path="./webgme/webgme.d.ts" />
import type {Diff, GMEJSONNodeType, NodePropertyExporter} from './models';

import {OmittedProperties} from './Utils';


type Core = GmeClasses.Core;

const Constants = {
    META_ASPECT_SET_NAME: 'MetaAspectSet',
};


export class WebGMEJSONImporter {
    core: Core;
    rootNode: Core.Node;
    diff: Diff

    constructor(core: Core, rootNode: Core.Node, diff: Diff) {
        this.core = core;
        this.rootNode = rootNode;
        this.diff = diff;
    }

    async _metaDictToGuids(meta_dict: { [key: string]: Core.Node | any } | null): Promise<{ [key: string]: Core.Node } | null> {
        if (meta_dict === null) return meta_dict;
        return Object.fromEntries(
            await Promise.all(Object.entries(meta_dict).map(async ([key, value]) => {
                if (key === 'min' || key === 'max') return [key, value];
                const node = await this.core.loadByPath(this.rootNode, key);
                return [this.core.getGuid(node), value];
            }))
        );
    }

    async toJSON(node: Core.Node, omit: OmittedProperties | boolean = new OmittedProperties()): Promise<GMEJSONNodeType> {
        if (typeof omit === 'boolean') {
            const omitList = omit ? ['children'] : [];
            omit = new OmittedProperties(omitList);
        } // Backwards compatible with shallow

        return await this._toJSON(node, omit);
    }

    async _toJSON(node: Core.Node, toOmit: Set<string>): Promise<GMEJSONNodeType> {
        const json: GMEJSONNodeType = {
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

        const exporters: NodePropertyExporter = {
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
                    const children = await this.core.loadChildren(node);
                    json.children = await Promise.all(
                        children.map(child => this._toJSON(child, toOmit))
                    );
                })());
            },

            children_meta: (node, json, promiseQueue) => {
                promiseQueue.push(
                    this._metaDictToGuids(this.core.getChildrenMeta(node))
                        .then(children_meta => children_meta ? json.children_meta = children_meta : () => {
                        })
                        .catch(e => throw new Error(e))
                );
            }
        };
    }
}