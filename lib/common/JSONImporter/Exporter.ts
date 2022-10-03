/// <reference path="./webgme/webgme.d.ts" />
import type {
    JSONNode,
    GMERelationRuleType
} from './Models';

import {OmittedProperties} from './OmittedProperties';


type Core = GmeClasses.Core;

export class Exporter {
    core: Core;
    rootNode: Core.Node;

    constructor(core: Core, rootNode: Core.Node) {
        this.core = core
        this.rootNode = rootNode;
    }

    async _metaDictToGuids(meta_dict: Core.RelationRule | null): Promise<GMERelationRuleType> {
        if (meta_dict === null) return meta_dict;
        return Object.fromEntries(
            await Promise.all(Object.entries(meta_dict).map(async ([key, value]) => {
                if (key === 'min' || key === 'max') return [key, value];
                const node = await this.core.loadByPath(this.rootNode, key);
                return [this.core.getGuid(node), value];
            }))
        );
    }

    getNewPromiseQueue(): Array<Promise<any>>  {
        return [] as Promise<any>[];
    }

    async toJSON(node: Core.Node, omit: OmittedProperties | boolean = new OmittedProperties()): Promise<Partial<JSONNode>> {
        if (typeof omit === 'boolean') {
            const omitList = omit ? ['children'] : [];
            omit = new OmittedProperties(omitList);
        } // Backwards compatible with shallow

        return await this._toJSON(node, omit);
    }

    async _toJSON(node: Core.Node, omitted: Set<string>): Promise<Partial<JSONNode>> {
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
            member_registry: {},
            member_attributes: {},
            children: [],
            children_meta: {},
        };

        omitted.forEach(toOmit => delete json[toOmit]);

        const promiseQueue = this.getNewPromiseQueue();
        Object.keys(json).forEach(key => {
            if (this[key]) {  // ToDo: Fix this not to use dynamic typings
                this[key](node, json, promiseQueue, omitted);
            }
        });
        await Promise.all(promiseQueue);
        return json;
    }

    attributes(node: Core.Node, json: Pick<JSONNode, 'attributes'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        this.core.getOwnAttributeNames(node).forEach(name => {
            json.attributes[name] = this.core.getAttribute(node, name);
        });
    }

    attribute_meta(node: Core.Node, json: Pick<JSONNode, 'attribute_meta'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        this.core.getOwnValidAttributeNames(node).forEach(name => {
            json.attribute_meta[name] = this.core.getAttributeMeta(node, name);
        });
    }

    sets(node: Core.Node, json: Pick<JSONNode, 'sets' | 'member_attributes' | 'member_registry'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        promiseQueue.push(...this.core.getOwnSetNames(node)
            .filter(name => name !== '_mixins')
            .map(async name => {
                const paths = this.core.getMemberPaths(node, name);
                const members = await Promise.all(paths.map(path => this.core.loadByPath(this.rootNode, path)));
                const memberGuids = members.map(member => this.core.getGuid(member));
                json.sets[name] = memberGuids;

                if (!omitted.has('member_attributes')) { // Alternatives to this closure variable?
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
                if (!omitted.has('member_registry')) {
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
    }

    pointers(node: Core.Node, json: Pick<JSONNode, 'pointers'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
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
    }

    registry(node: Core.Node, json: Pick<JSONNode, 'registry'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        this.core.getOwnRegistryNames(node).forEach(name => {
            json.registry[name] = this.core.getRegistry(node, name);
        });
    }

    children(node: Core.Node, json: Pick<JSONNode, 'children'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        promiseQueue.push((async () => {
            const children = await this.core.loadChildren(node);
            json.children = await Promise.all(
                children.map(child => this._toJSON(child, omitted))
            );
        })());
    }

    children_meta(node: Core.Node, json: Pick<JSONNode, 'children_meta'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        promiseQueue.push(
            this._metaDictToGuids(this.core.getChildrenMeta(node))
                .then((children_meta) => json.children_meta = children_meta)
        );
    }

    pointer_meta(node: Core.Node, json: Pick<JSONNode, 'pointer_meta'>, promiseQueue: Promise<any>[], omitted: Set<string>) {
        promiseQueue.push(...this.core.getOwnValidPointerNames(node).map(async name => {
            const ptr_meta = this.core.getPointerMeta(node, name);
            json.pointer_meta[name] = await this._metaDictToGuids(ptr_meta);
        }));
    }

    mixins(node: Core.Node, json: Pick<JSONNode, 'mixins'>, promiseQueue: Promise<any>, omitted: Set<string>) {
        json.mixins = Object.values(this.core.getMixinNodes(node)).map(node => this.core.getGuid(node));
    }
}
