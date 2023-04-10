/*globals define*/
/*eslint-env node, browser*/

define([
  "webgme-json-importer/JSONImporter",
  "text!./metadata.json",
  "plugin/PluginBase",
], function (JSONImporter, pluginMetadata, PluginBase) {
  "use strict";

  pluginMetadata = JSON.parse(pluginMetadata);

  class SetStateFromJSON extends PluginBase {
    constructor() {
      super();
      this.pluginMetadata = pluginMetadata;
    }

    async main() {
      const { srcHash } = this.getCurrentConfig();
      if (!srcHash) {
        throw new Error("JSON file required.");
      }
      const srcContents = await this.blobClient.getObjectAsString(
        srcHash,
      );
      const newState = JSON.parse(srcContents);
      const importer = new JSONImporter(this.core, this.rootNode);
      await importer.apply(this.activeNode, newState);
      await this.save("Model updated to new state.");
      this.result.setSuccess(true);
    }
  }

  SetStateFromJSON.metadata = pluginMetadata;

  return SetStateFromJSON;
});
