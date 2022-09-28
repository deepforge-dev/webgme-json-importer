/*globals define*/
/*eslint-env node, browser*/

define([
    'webgme-json-importer/JSONImporter',
    'text!./metadata.json',
    'plugin/PluginBase'
], function (
    ImporterLib,
    pluginMetadata,
    PluginBase
) {
    'use strict';
    pluginMetadata = JSON.parse(pluginMetadata);
    const JSONImporter = ImporterLib.default;

    class ExportToJSON extends PluginBase {
        constructor() {
            super();
            this.pluginMetadata = pluginMetadata;
        }

        async main() {
            const importer = new JSONImporter(this.core, this.rootNode);
            const json = await importer.toJSON(this.activeNode);
            const nodeName = this.core.getAttribute(this.activeNode, 'name');
            this.addFile(`${nodeName}.json`, JSON.stringify(json, null, 2));
            this.result.setSuccess(true);
        }
    }

    ExportToJSON.metadata = pluginMetadata;

    return ExportToJSON;
});
