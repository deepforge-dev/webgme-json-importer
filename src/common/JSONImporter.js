/* globals define */
/* eslint-env browser, node */

define([
    './build/JSONImporter.umd'
], function (ImporterLib) {
    const {default: JSONImporter,  diff, NodeSelections, NodeChangeSet, NodeSelector, OmittedProperties, gmeDiff} = ImporterLib;

    JSONImporter.diff = diff;
    JSONImporter.NodeChangeSet = NodeChangeSet;
    JSONImporter.NodeSelections = NodeSelections;
    JSONImporter.NodeSelector = NodeSelector;
    JSONImporter.OmittedProperties = OmittedProperties;
    JSONImporter.gmeDiff = gmeDiff;

    return JSONImporter;
});
