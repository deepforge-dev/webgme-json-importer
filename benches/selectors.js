const Benchmark = require('benchmark');
const suite = new Benchmark.Suite();

// add tests


const testFixture = require('../test/globals');
const _ = testFixture.requirejs('underscore');
const Core = testFixture.requirejs('common/core/coreQ');
const Importer = testFixture.requirejs('webgme-json-importer/JSONImporter');
const NodeSelections = Importer.NodeSelections;
const assert = require('assert');
const gmeConfig = testFixture.getGmeConfig();
const path = testFixture.path;
const SEED_DIR = path.join(__dirname, '..', 'src', 'seeds');
const Q = testFixture.Q;
const logger = testFixture.logger.fork('JSONImporter');
const projectName = 'testProject';
let project,
    gmeAuth,
    storage,
    commitHash,
    core;

async function setupGME() {
    gmeAuth = await testFixture.clearDBAndGetGMEAuth(gmeConfig, projectName);
    storage = testFixture.getMemoryStorage(logger, gmeConfig, gmeAuth);
    await storage.openDatabase();
    const importParam = {
        projectSeed: path.join(SEED_DIR, 'test', 'test.webgmex'),
        projectName: projectName,
        branchName: 'master',
        logger: logger,
        gmeConfig: gmeConfig
    };

    const importResult = await testFixture.importProject(storage, importParam);
    project = importResult.project;
    core = new Core(project, {
        globConf: gmeConfig,
        logger: logger.fork('core')
    });
    commitHash = importResult.commitHash;
}

async function cleanUp() {
    await storage.closeDatabase();
    await gmeAuth.unload();
}

let counter = 1;
async function getNewRootNode(core) {
    const branchName = 'test' + counter++;
    await project.createBranch(branchName, commitHash);
    const branchHash = await project.getBranchHash(branchName);
    const commit = await Q.ninvoke(project, 'loadObject', branchHash);
    return await Q.ninvoke(core, 'loadRoot', commit.root);
}

let importer,
    node,
    original,
    root,
    fco;

async function getNewProject() {
    const root = await getNewRootNode(core);
    const fco = await core.loadByPath(root, '/1');
    const importer = new Importer(core, root);
    return {
        root, fco, importer
    };
}

console.log('about to benchmark @guid');
function asyncBench(fn) {
    return {
        defer: true,
        async fn(deferred) {
            await fn();
            deferred.resolve();
        }
    }
}

// TODO: initialize the project
async function runBenchmarks() {
    const {root, fco, importer} = await getNewProject();
    const parent = root;
    const base = fco;
    for (let i = 0; i < 900; i++) {
        const node = core.createNode({parent, base});
        core.setAttribute(node, 'name', `node_${i}`);
    }

    const guids = [...new Array(100)].map((_, i) => {
        const node = core.createNode({parent, base});
        core.setAttribute(node, 'name', `selected_node_${i}`);
        return core.getGuid(node);
    });

    const json = {
        children: guids.map(guid => ({id: `@guid:${guid}`})),
    };
    suite.add('resolve 100 @guid nodes (among 1000 children)', asyncBench(async function() {
        const selectors = new NodeSelections();
        await importer.resolveSelectors(root, json, selectors);
    }))
    .on('complete', function() {
      this.forEach(bench => console.log(bench.stats));
    })
    // run async
    .run({ 'async': true });
}

setupGME()
    .then(runBenchmarks)
    .then(cleanUp)
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
