
const RELATED_PROPERTIES = {
    sets: ['member_attributes', 'member_registry'],
    children: ['children_meta'],
    attributes: ['attributes_meta'],
    pointers: ['pointer_meta'],
};

const INVALID_PROPS = ['id', 'guid', 'path'];


export class OmittedProperties extends Set<string> {
    constructor(args: string[]|null|undefined = null) {
        super(args);
    }


}