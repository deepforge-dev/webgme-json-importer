/*eslint-env node, mocha*/

describe('ExportToJSON', function () {
    const {promisify} = require('util');
    const assert = require('assert').strict;
    var testFixture = require('../../globals'),
        gmeConfig = testFixture.getGmeConfig(),
        logger = testFixture.logger.fork('ExportToJSON'),
        PluginCliManager = testFixture.WebGME.PluginCliManager,
        projectName = 'testProject',
        pluginName = 'ExportToJSON',
        project,
        gmeAuth,
        storage,
        commitHash;

    const manager = new PluginCliManager(null, logger, gmeConfig);
    manager.executePlugin = promisify(manager.executePlugin.bind(manager));

    before(async function () {
        gmeAuth = await testFixture.clearDBAndGetGMEAuth(gmeConfig, projectName)
        storage = testFixture.getMemoryStorage(logger, gmeConfig, gmeAuth);
        await storage.openDatabase();
        const importParam = {
            projectSeed: testFixture.path.join(testFixture.SEED_DIR, 'EmptyProject.webgmex'),
            projectName: projectName,
            branchName: 'master',
            logger: logger,
            gmeConfig: gmeConfig
        };

        const importResult = await testFixture.importProject(storage, importParam);
        project = importResult.project;
        commitHash = importResult.commitHash;
        await project.createBranch('test', commitHash);
    });

    after(async function () {
        await storage.closeDatabase()
        await gmeAuth.unload();
    });

    it('should run plugin and update the branch', async function () {
            pluginConfig = {
            },
            context = {
                project: project,
                commitHash: commitHash,
                branchName: 'test',
                activeNode: '/1',
            };

        const pluginResult = await manager.executePlugin(pluginName, pluginConfig, context);
        assert.equal(typeof pluginResult, 'object');
        assert(pluginResult.success);
        const branchHash = await project.getBranchHash('test');
        assert.equal(branchHash, commitHash);
    });
});
