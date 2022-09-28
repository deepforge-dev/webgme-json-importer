import {DiffObj, DiffTypes} from './Models';

export class NodeChangeSet implements DiffObj{
    parentPath: string;
    nodeId: string;
    key: string[];
    type: DiffTypes;
    value: any;

    constructor(parentPath: string, nodeId: string, type: DiffTypes, key: string[], value: any) {
        this.parentPath = parentPath;
        this.nodeId = nodeId;
        this.type = type;
        this.key = key;
        this.value = value;
    }

    static fromDiffObj(parentPath, nodeId, diffObj: DiffObj) {
        return new NodeChangeSet(
            parentPath,
            nodeId,
            diffObj.type,
            diffObj.key,
            diffObj.value
        );
    }
}
