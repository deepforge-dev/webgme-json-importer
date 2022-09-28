import exp from "constants";

export type Diff = (obj1: any, obj2: any) => any;


export type GMEAttributesType = { [key: string]: GmeCommon.OutAttr };
export type GMEAttributeMetaType = { [key: string]: GmeCommon.DefObject };
export type GMEPointerMetaType = { [key: string]: GMERelationRuleType };
export type GMEPointersType = { [key: string]: Core.GUID | GmeCommon.OutPath };
export type GMERelationRuleType = { [key: Core.GUID]: Core.RelationRuleDetail } | null;

export type GMEGuidToOutAttrType = { [key: Core.GUID]: GmeCommon.OutAttr };
export type GMESetsType = { [key: string]: Core.GUID[] };
export type MemberAttributeType = {
    [key: string]: GMEGuidToOutAttrType
}

export type MemberRegistryType = {
    [key: string]: GMEGuidToOutAttrType
}

export interface GMEJSONNodeType {
    id: string;
    path: string;
    guid: string;
    alias: string;
    attributes: GMEAttributesType,
    attribute_meta: GMEAttributeMetaType,
    pointers: GMEPointersType,
    pointer_meta: GMEPointerMetaType,
    mixins: Core.GUID[],
    registry: GMEGuidToOutAttrType,
    sets: GMESetsType,
    member_registry: MemberRegistryType,
    member_attributes: MemberAttributeType,
    children: GMEJSONNodeType[] | Partial<GMEJSONNodeType>[]
    children_meta: GMERelationRuleType,
}

export enum DiffTypes {
    PUT = 'put',
    DEL = 'del'
}

export interface DiffObj {
    type: DiffTypes,
    key: string[],
    value: any
};