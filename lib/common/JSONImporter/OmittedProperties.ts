const RELATED_PROPERTIES: {[key: string]: string[]} = {
    sets: ['member_attributes', 'member_registry'],
    children: ['children_meta'],
    attributes: ['attributes_meta'],
    pointers: ['pointer_meta'],
};

const INVALID_PROPS = ['id', 'guid', 'path'];

export class OmittedProperties extends Set<string> {
    constructor(args: string[]|null|undefined = undefined) {
        super(args);
        const invalidProperties = INVALID_PROPS.filter(prop => this.has(prop));

        if(invalidProperties.length) {
            throw new Error(`Invalid properties to omit: ${invalidProperties.join(', ')}`);
        }
    }

    withRelatedProperties(): OmittedProperties {
        const relatedProps = Object.keys(RELATED_PROPERTIES)
            .filter(key => this.has(key))
            .flatMap(key => RELATED_PROPERTIES[key]);

        relatedProps.forEach(dep => this.add(dep));
        return this;
    }
}
