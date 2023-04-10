/*eslint-env node, mocha*/

describe("SetStateFromJSON", function () {
  const assert = require("assert").strict;
  const { promisify } = require("util");
  var testFixture = require("../../globals"),
    gmeConfig = testFixture.getGmeConfig(),
    expect = testFixture.expect,
    logger = testFixture.logger.fork("SetStateFromJSON"),
    PluginCliManager = testFixture.WebGME.PluginCliManager,
    projectName = "testProject",
    pluginName = "SetStateFromJSON",
    project,
    gmeAuth,
    storage,
    commitHash;

  const manager = new PluginCliManager(null, logger, gmeConfig);
  manager.executePlugin = promisify(manager.executePlugin.bind(manager));

  before(async function () {
    gmeAuth = await testFixture.clearDBAndGetGMEAuth(
      gmeConfig,
      projectName,
    );
    storage = testFixture.getMemoryStorage(logger, gmeConfig, gmeAuth);
    await storage.openDatabase();
    const importParam = {
      projectSeed: testFixture.path.join(
        testFixture.SEED_DIR,
        "EmptyProject.webgmex",
      ),
      projectName: projectName,
      branchName: "master",
      logger: logger,
      gmeConfig: gmeConfig,
    };

    const importResult = await testFixture.importProject(
      storage,
      importParam,
    );
    project = importResult.project;
    commitHash = importResult.commitHash;
    await project.createBranch("test", commitHash);
  });

  after(async function () {
    await storage.closeDatabase();
    await gmeAuth.unload();
  });

  it("should require JSON file", async function () {
    var pluginConfig = {},
      context = {
        project: project,
        commitHash: commitHash,
        branchName: "test",
        activeNode: "/1",
      };

    await assert.rejects(
      () => manager.executePlugin(pluginName, pluginConfig, context),
      /JSON file required/,
    );
  });
});
