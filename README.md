# webgme-json-meta
This repo contains a META description language for WebGME which can be imported/exported using [JSON Importer](./src/common/JSONImporter.js). More information about the specification can be found [here](./src/common/). For examples, check out the examples directory.

## Installation
First, install the webgme-json-meta following:
- [NodeJS](https://nodejs.org/en/) (LTS recommended)
- [MongoDB](https://www.mongodb.com/)

Second, start mongodb locally by running the `mongod` executable in your mongodb installation (you may need to create a `data` directory or set `--dbpath`).

Then, run `webgme start` from the project root to start . Finally, navigate to `http://localhost:8888` to start using webgme-json-meta!
