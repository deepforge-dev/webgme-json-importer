export type GMERelationRuleType = { [key: Core.GUID]: Core.RelationRuleDetail } | null;
export type GMEOutAttrDictionary = GmeCommon.Dictionary<GmeCommon.OutAttr>;
export type GMEDefObjectDictionary = GmeCommon.Dictionary<GmeCommon.DefObject>;
export type GMEPointersDictionary = GmeCommon.Dictionary<Core.GUID | GmeCommon.OutPath>;
export type GMERelationRuleDictionary = GmeCommon.Dictionary<GMERelationRuleType>;


export default interface NodeState {
    id: string;
    path: GmeCommon.Path;
    guid: Core.GUID;
    alias: string;
    attributes: GMEOutAttrDictionary;
    attribute_meta: GMEDefObjectDictionary;
    pointers: GMEPointersDictionary;
    pointer_meta: GMERelationRuleDictionary;
    mixins: Core.GUID[];
    registry: GMEOutAttrDictionary;
    sets: GmeCommon.Dictionary<Core.GUID[]>;
    member_registry: GmeCommon.Dictionary<{[key: Core.GUID]: GMEOutAttrDictionary}>;
    member_attributes: GmeCommon.Dictionary<{[key: Core.GUID]: GMEOutAttrDictionary}>;
    children: NodeState[] | Partial<NodeState>[];
    children_meta: GMERelationRuleType;
}
