/*globals define*/
/*eslint-env node, browser*/

define([
    'webgme-json-meta/JSONImporter',
    'text!./metadata.json',
    'plugin/PluginBase'
], function (
    JSONImporter,
    pluginMetadata,
    PluginBase
) {
    'use strict';

    pluginMetadata = JSON.parse(pluginMetadata);

    // FIXME: rename this plugin:
    //   - SyncWithJSON?
    //   - SetStateFromJSON (current fav)
    //
    // To Do:
    //   - [ ] Create an example JSON to import (in the language node)
    //     - [ ] add containment rule
    class ImportFromJSON extends PluginBase {
        constructor() {
            super();
            this.pluginMetadata = pluginMetadata;
        }

        async main() {
            const {srcHash} = this.getCurrentConfig();
            if (!srcHash) {
                throw new Error('JSON file required.');
            }
            const srcContents = await this.blobClient.getObjectAsString(srcHash);
            const newState = JSON.parse(srcContents);
            const importer = new JSONImporter(this.core, this.rootNode);
            await importer.apply(this.activeNode, newState);
            await this.save('Model updated to new state.')
            this.result.setSuccess(true);
        }
    }

    ImportFromJSON.metadata = pluginMetadata;

    return ImportFromJSON;
});
