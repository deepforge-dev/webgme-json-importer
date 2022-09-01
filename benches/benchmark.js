const Benchmark = require('benchmark');

const testFixture = require('../test/globals');
const _ = testFixture.requirejs('underscore');
const Core = testFixture.requirejs('common/core/coreQ');
const Importer = testFixture.requirejs('webgme-json-importer/JSONImporter');
const gmeConfig = testFixture.getGmeConfig();
const Q = testFixture.Q;
const logger = testFixture.logger.fork('JSONImporter');
const projectName = 'testProject';

// let

class WJIBenchmark {
    constructor(projectSeedName, callable) {
        this.projectSeedName = projectSeedName;
        this.project = null;
        this.gmeAuth = null;
        this.storage = null;
        this.commitHash = null;
        this.core = null;
        this.branchCounter = 1;
        this.callable = callable;
        this.suite = new Benchmark.Suite();
    }

    async getNewRootNode() {
        const branchName = 'test' + this.branchCounter++;
        await this.project.createBranch(branchName, this.commitHash);
        const branchHash = await this.project.getBranchHash(branchName);
        const commit = await Q.ninvoke(this.project, 'loadObject', branchHash);
        return await Q.ninvoke(this.core, 'loadRoot', commit.root);
    }

    async getNewProject() {
        const root = await this.getNewRootNode(this.core);
        const fco = await this.core.loadByPath(root, '/1');
        const importer = new Importer(this.core, root);
        return {
            root, fco, importer
        };
    }

    async before() {
        await this._setupGME();
    }

    async _setupGME() {
        this.gmeAuth = await testFixture.clearDBAndGetGMEAuth(gmeConfig, projectName);
        this.storage = testFixture.getMemoryStorage(logger, gmeConfig, this.gmeAuth);
        await this.storage.openDatabase();
        const importParam = {
            projectSeed: testFixture.path.join(testFixture.TESTS_SEED_DIR, this.projectSeedName, `${this.projectSeedName}.webgmex`),
            projectName: projectName,
            branchName: 'master',
            logger: logger,
            gmeConfig: gmeConfig
        };

        const importResult = await testFixture.importProject(this.storage, importParam);
        this.project = importResult.project;
        this.core = new Core(this.project, {
            globConf: gmeConfig,
            logger: logger.fork('core')
        });
        this.commitHash = importResult.commitHash;
    }

    async after() {
        await this.storage.closeDatabase();
        await this.gmeAuth.unload();
    }

    async run() {
        await this.before();
        const {root, fco, importer} = await this.getNewProject();
        await this.callable({root, fco, importer, core: this.core, suite: this.suite});
        this.suite.on('complete', function() {
            this.forEach(bench => console.log(bench.stats));
        }).run({ 'async': true }); // runAsync
        await this.after();
    }
}

module.exports = WJIBenchmark;