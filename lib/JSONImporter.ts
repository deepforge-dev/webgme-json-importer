/// <reference path="./webgme/webgme.d.ts" />
import type {
    Diff,
    GMEAttributeMetaType,
    GMEAttributesType, GMEGuidToOutAttrType,
    GMEJSONNodeType,
    GMEPointersType,
    GMERelationRuleType, GMESetsType, MemberRegistryType
} from './models';

import {OmittedProperties} from './Utils';
import {GMEPointerMetaType, MemberAttributeType} from "./models";


type Core = GmeClasses.Core;

const Constants = {
    META_ASPECT_SET_NAME: 'MetaAspectSet',
};

type JSONodeExportKeys = keyof GMEJSONNodeType

class JSONExporter {
    core: Core;
    rootNode: Core.Node;
    omitted: OmittedProperties;
    promiseQueue: Promise<any>[];

    constructor(core: Core, rootNode: Core.Node, omitted: OmittedProperties = new OmittedProperties()) {
        this.core = core
        this.rootNode = rootNode;
        this.omitted = omitted;
        this.promiseQueue = [];
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

    clearPromiseQueue(): void {
        this.promiseQueue = [];
    }

    setOmittedProperties(omitted: OmittedProperties): void {
        this.omitted = omitted;
    }

    async toJSON(node: Core.Node, omit: OmittedProperties|boolean =new OmittedProperties()): Promise<Partial<GMEJSONNodeType>> {
        if (typeof omit === 'boolean') {
            const omitList = omit ? ['children'] : [];
            omit = new OmittedProperties(omitList);
        } // Backwards compatible with shallow

        this.setOmittedProperties(omit);
        this.clearPromiseQueue();
        const json = await this._toJSON(node);
        this.clearPromiseQueue();
        return json;
    }

    async _toJSON(node: Core.Node): Promise<Partial<GMEJSONNodeType>> {
        const json: Partial<GMEJSONNodeType> = {
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

        this.omitted.forEach(key => {
            const accessor = key as keyof typeof json;
            delete json[accessor];
        });

        Object.keys(json).forEach((key)=> {
            const accessor = key as Exclude<keyof JSONExporter, '_toJSON'| 'toJSON' | 'setOmittedProperties' | 'clearPromiseQueue' | '_metaDictToGuids'>;
            if (this[accessor]) {
                const fn = this[accessor];
                if(typeof fn === 'function') {
                    fn(node, json as GMEJSONNodeType);
                }
            }
        });

        await Promise.all(this.promiseQueue);
        return json;
    }

    attributes(node: Core.Node, json: Required<{attributes: GMEAttributesType}>) {
        this.core.getOwnAttributeNames(node).forEach(name => {
            json.attributes[name] = this.core.getAttribute(node, name);
        });
    }

    attribute_meta(node: Core.Node, json: Required<{attribute_meta: GMEAttributeMetaType}>) {
        this.core.getOwnValidAttributeNames(node).forEach(name => {
            json.attribute_meta[name] = this.core.getAttributeMeta(node, name);
        });
    }

    pointers(node: Core.Node, json: Required<{pointers: GMEPointersType}>) {
        this.promiseQueue.push(...this.core.getOwnPointerNames(node).map(async name => {
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

    mixins(node: Core.Node, json: Required<{mixins: Core.GUID[]}>) {
        json.mixins = Object.values(this.core.getMixinNodes(node)).map(node => this.core.getGuid(node));
    }

    pointer_meta (node: Core.Node, json: Required<{pointer_meta: GMEPointerMetaType}>) {
        this.promiseQueue.push(...this.core.getOwnValidPointerNames(node).map(async name => {
            const ptr_meta = this.core.getPointerMeta(node, name);
            json.pointer_meta[name] = await this._metaDictToGuids(ptr_meta);
        }));
    }

    registry(node: Core.Node, json: Required<{registry: GMEGuidToOutAttrType}>) {
        this.core.getOwnRegistryNames(node).forEach(name => {
            json.registry[name] = this.core.getRegistry(node, name);
        });
    }

    sets(node: Core.Node, json: Required<{sets: GMESetsType, member_attributes: MemberAttributeType, member_registry: MemberRegistryType}>) {
        this.promiseQueue.push(...this.core.getOwnSetNames(node)
            .filter(name => name !== '_mixins')
            .map(async name => {
                const paths = this.core.getMemberPaths(node, name);
                const members = await Promise.all(paths.map(path => this.core.loadByPath(this.rootNode, path)));
                const memberGuids = members.map(member => this.core.getGuid(member));
                json.sets[name] = memberGuids;

                if (!this.omitted.has('member_attributes')) { // Alternatives to this closure variable?
                    members.forEach(member => {
                        let guid = this.core.getGuid(member);
                        let memberPath = this.core.getPath(member);

                        json.member_attributes[name] = {} as GMEGuidToOutAttrType;
                        json.member_attributes[name][guid] = {} as  Exclude<GmeCommon.OutAttr, null>;
                        this.core.getMemberAttributeNames(node, name, memberPath).forEach(attrName => {
                            const value = this.core.getMemberAttribute(node, name, memberPath, attrName);
                            const attr = json.member_attributes[name];
                            attr? attr[guid][attrName] = value;
                        });
                    });
                }
                if (!this.omitted.has('member_registry')) {
                    members.forEach(member => {
                        let guid = this.core.getGuid(member);
                        let memberPath = this.core.getPath(member);

                        json.member_registry[name] = {} as GMEGuidToOutAttrType;
                        json.member_registry[name][guid] = {} as GmeCommon.OutAttr;
                        this.core.getMemberRegistryNames(node, name, memberPath).forEach(regName => {
                            const value = this.core.getMemberRegistry(node, name, memberPath, regName);
                            json.member_registry[name][guid][regName] = value;
                        });
                    });
                }

            }));
    }

    children(node: Core.Node, json: GMEJSONNodeType) {
        this.promiseQueue.push((async () => {
            const children = await this.core.loadChildren(node);
            json.children = await Promise.all(
                children.map(child => this._toJSON(child))
            );
        })());
    }


    children_meta(node: Core.Node, json: GMEJSONNodeType) {
        this.promiseQueue.push(
            this._metaDictToGuids(this.core.getChildrenMeta(node))
                .then(children_meta => {
                    json.children_meta = children_meta;
                })
        );
    }
}


export class JSONImporter extends JSONExporter{
    diff: Diff

    constructor(core: Core, rootNode: Core.Node, diff: Diff) {
        super(core, rootNode);
        this.diff = diff;
    }


}