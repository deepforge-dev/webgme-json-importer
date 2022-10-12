import {ChangeSet, ChangeType} from 'changeset';
import {Result} from 'ts-monads';

export type NodeChangeSetType = ChangeType;

export class NodeChangeSet implements ChangeSet {
    parentPath: string;
    nodeId: string;
    key: string[];
    type: ChangeType;
    value: any;

    constructor(parentPath: string, nodeId: string, type: ChangeType, key: string[], value: any) {
        this.parentPath = parentPath;
        this.nodeId = nodeId;
        this.type = type;
        this.key = key;
        this.value = value;
    }

    static fromChangeSet(parentPath: string, nodeId: string, diffObj: ChangeSet) {
        return new NodeChangeSet(
            parentPath,
            nodeId,
            diffObj.type,
            diffObj.key,
            diffObj.value
        );
    }

    validated(fn: (ch: NodeChangeSet) => boolean, errMsg: string): Result<NodeChangeSet, Error> {
        if (fn(this)) {
            return Result.Ok(this);
        } else {
            const err = new Error(errMsg);
            return Result.Error(err);
        }
    }

    asResult(): Result<NodeChangeSet, Error> {
        return Result.Ok(this);
    }
}
