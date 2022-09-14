export type Diff = (obj1:any, obj2: any) => any;

export type NodePropertyExporter = {[key: string]: (node: Core.Node, json: GMEJSONNodeType, promiseQueue: Promise<any>[]) => void}

type GMEAttributesType = {[key: string]: string|number|string[]|number[]};
type GMEPointersType = {[key: string]: string};
type GMERegistryType = {[key: string]: string};
type GMESetsType = {[key: string]: string[]};

export interface GMEJSONNodeType {
    id: string;
    path: string;
    guid: string;
    attributes?: GMEAttributesType,
    attribute_meta?: GMEAttributesType,
    pointers?: GMEAttributesType,
    pointer_meta?: GMEPointersType,
    mixins?: string[],
    registry?: GMERegistryType,
    sets?: GMESetsType,
    member_registry?: any, //ToDo
    member_attributes?: any, // ToDo
    children?: GMEJSONNodeType[]
    children_meta?: any, // ToDo
}