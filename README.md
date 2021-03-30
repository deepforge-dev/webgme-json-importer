# webgme-json-importer
This repo contains a utilities for importing/exporting models as JSON. The main utility is the [JSON Importer](./src/common/JSONImporter.js) which enables a WebGME node to be synchronized with a JSON representation of the target state. This has been primarily used for programmatically creating (and updating) metamodels based off of an external representation. In these cases, the workflow is:
- extract the language specification from the target domain
- transform the specification into the expected JSON representation (documentation available [here](./src/common/)).
- import the JSON representation into a project. If you first create a node to contain the language elements (conventionally named "Language"), this can be as simple as selecting this node and running the "SetStateFromJSON" plugin).

For examples, check out the examples directory.

## Installation
First, install the webgme-json-importer following:
- [NodeJS](https://nodejs.org/en/) (LTS recommended)
- [MongoDB](https://www.mongodb.com/)

Second, start mongodb locally by running the `mongod` executable in your mongodb installation (you may need to create a `data` directory or set `--dbpath`).

Then, install dependencies with `npm install` and start the server with `npm start`. Finally, navigate to `http://localhost:8888` to start using webgme-json-importer!
