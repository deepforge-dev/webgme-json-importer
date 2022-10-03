import {JSONNode} from './Models';
import {compare} from "./Utils";

export function gmeDiff(prevState, newState) {
    const keyOrder = [
        'children_meta',
        'pointer_meta',
        'pointers',
        'mixins',
        'sets',
        'member_attributes',
        'member_registry',
    ];

    const changes = compare(prevState, newState);
    const singleKeyFields = ['children_meta', 'guid'];
    const sortedChanges = changes.filter(
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
    return sortedChanges;
}
