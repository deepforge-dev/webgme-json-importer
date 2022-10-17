import { ChangeSet, ChangeType } from 'changeset';

export type NodeChangeSetType = ChangeType;
export class NodeChangeSet implements ChangeSet {
    parentPath: string;
    nodeId: string;
    key: string[];
    type: ChangeType;
    value: any;

    constructor(
        parentPath: string,
        nodeId: string,
        type: ChangeType,
        key: string[],
        value: any
    ) {
        this.parentPath = parentPath;
        this.nodeId = nodeId;
        this.type = type;
        this.key = key;
        this.value = value;
    }

    static fromChangeSet(
        parentPath: string,
        nodeId: string,
        diffObj: ChangeSet
    ) {
        return new NodeChangeSet(
            parentPath,
            nodeId,
            diffObj.type,
            diffObj.key,
            diffObj.value
        );
    }
}
