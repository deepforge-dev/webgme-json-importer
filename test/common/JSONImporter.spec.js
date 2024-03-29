/*jshint node:true, mocha:true*/

"use strict";

describe("JSONImporter", function () {
  const testFixture = require("../globals");
  const _ = testFixture.requirejs("underscore");
  const Core = testFixture.requirejs("common/core/coreQ");
  const Importer = testFixture.requirejs("webgme-json-importer/JSONImporter");
  const { OmittedProperties, NodeSelections, NodeChangeSet } = Importer;
  const assert = require("assert");
  const gmeConfig = testFixture.getGmeConfig();
  const path = testFixture.path;
  const SEED_DIR = path.join(__dirname, "..", "..", "src", "seeds");
  const Q = testFixture.Q;
  const logger = testFixture.logger.fork("JSONImporter");
  const projectName = "testProject";
  let project, gmeAuth, storage, commitHash, core;

  before(async function () {
    this.timeout(7500);
    gmeAuth = await testFixture.clearDBAndGetGMEAuth(
      gmeConfig,
      projectName,
    );
    storage = testFixture.getMemoryStorage(logger, gmeConfig, gmeAuth);
    await storage.openDatabase();
    const importParam = {
      projectSeed: path.join(SEED_DIR, "test", "test.webgmex"),
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
    core = new Core(project, {
      globConf: gmeConfig,
      logger: logger.fork("core"),
    });
    commitHash = importResult.commitHash;
  });

  after(async function () {
    await storage.closeDatabase();
    await gmeAuth.unload();
  });

  let counter = 1;
  async function getNewRootNode(core) {
    const branchName = "test" + counter++;
    await project.createBranch(branchName, commitHash);
    const branchHash = await project.getBranchHash(branchName);
    const commit = await Q.ninvoke(project, "loadObject", branchHash);
    return await Q.ninvoke(core, "loadRoot", commit.root);
  }

  let importer, node, original, root, fco;

  beforeEach(async () => {
    root = await getNewRootNode(core);
    fco = await core.loadByPath(root, "/1");
    importer = new Importer(core, root);
    node = (await core.loadChildren(root))[0];
    original = await importer.toJSON(node);
  });

  describe("attributes", function () {
    it("should set attributes", async function () {
      original.attributes.name = "hello world!";
      await importer.apply(node, original);
      assert.equal(core.getAttribute(node, "name"), "hello world!");
    });

    it("should set attributes using @name", async function () {
      const container = core.createNode({ base: fco, parent: root });
      const child = core.createNode({ base: fco, parent: container });
      core.setAttribute(child, "name", "TEST!");
      const schema = await importer.toJSON(container);
      schema.children = [
        {
          id: "@name:TEST!",
          attributes: { name: "NewName" },
        },
      ];
      await importer.apply(container, schema);
      assert.equal(core.getAttribute(child, "name"), "NewName");
    });

    it("should set attributes using @attribute:name:<name>", async function () {
      const container = core.createNode({ base: fco, parent: root });
      const child = core.createNode({ base: fco, parent: container });
      core.setAttribute(child, "name", "TEST!");
      const schema = await importer.toJSON(container);
      schema.children = [
        {
          id: "@attribute:name:TEST!",
          attributes: { name: "NewName" },
        },
      ];
      await importer.apply(container, schema);
      assert.equal(core.getAttribute(child, "name"), "NewName");
    });

    it("should delete attributes", async function () {
      delete original.attributes.name;
      await importer.apply(node, original);
      assert.equal(core.getAttribute(node, "name"), undefined);
    });

    it('should ignore attributes if missing "attributes"', async function () {
      delete original.attributes;
      await importer.apply(node, original);
      assert.equal(core.getAttribute(node, "name"), "FCO");
    });
  });

  describe("attribute meta", function () {
    it("should add to attribute meta", async function () {
      original.attribute_meta.test = { type: "string" };
      await importer.apply(node, original);
      assert.notEqual(core.getAttributeMeta(node, "test"), undefined);
      assert.equal(core.getAttributeMeta(node, "test").type, "string");
    });

    it("should delete attribute meta", async function () {
      delete original.attribute_meta.name;
      await importer.apply(node, original);
      assert.equal(core.getAttributeMeta(node, "name"), undefined);
    });

    it("should update attribute meta fields", async function () {
      original.attribute_meta.name.type = "boolean";
      await importer.apply(node, original);
      assert.equal(core.getAttributeMeta(node, "name").type, "boolean");
    });

    it("should change attribute to enum", async function () {
      original.attribute_meta.name.enum = ["a", "b"];
      await importer.apply(node, original);
      assert.deepEqual(core.getAttributeMeta(node, "name").enum, [
        "a",
        "b",
      ]);
    });

    it("should change attribute from enum", async function () {
      core.setAttributeMeta(node, "name", {
        type: "string",
        enum: ["a", "b"],
      });
      await importer.apply(node, original);
      assert.equal(core.getAttributeMeta(node, "name").enum, undefined);
    });

    it("should change attribute enum values", async function () {
      core.setAttributeMeta(node, "name", {
        type: "string",
        enum: ["a", "b"],
      });
      original.attribute_meta.name.enum = ["b", "c", "a"];
      await importer.apply(node, original);
      assert.deepEqual(core.getAttributeMeta(node, "name").enum, [
        "b",
        "c",
        "a",
      ]);
    });
  });

  describe("registry", function () {
    it("should add registry values", async function () {
      original.registry.name = "hello world!";
      await importer.apply(node, original);
      assert.equal(core.getRegistry(node, "name"), "hello world!");
    });

    it("should delete registry values", async function () {
      delete original.registry.position;
      await importer.apply(node, original);
      assert.equal(core.getRegistry(node, "position"), undefined);
    });

    it("should update registry fields", async function () {
      original.registry.position.x = 500;
      const { y } = original.registry.position;
      await importer.apply(node, original);
      assert.equal(core.getRegistry(node, "position").x, 500);
      const newY = core.getRegistry(node, "position").y;
      assert.equal(newY, y, `Changed y value from ${y} to ${newY}`);
    });
  });

  describe("multiple nodes", function () {
    let node2, node3;
    let original2;

    beforeEach(async () => {
      const base = node;
      const parent = root;
      node2 = core.createNode({ base, parent });
      core.setAttribute(node2, "name", "Node2");
      node3 = core.createNode({ base, parent });
      core.setPointer(node2, "existingPtr", node3);
      core.setAttribute(node3, "name", "Node3");
      original2 = await importer.toJSON(node2);
    });

    describe("pointers", function () {
      it("should add pointer", async function () {
        const nodePath = core.getPath(node2);
        original.pointers.newPtr = nodePath;
        await importer.apply(node, original);
        assert.equal(core.getPointerPath(node, "newPtr"), nodePath);
      });

      it("should add pointer using @meta tag", async function () {
        const nodePath = core.getPath(node);
        original.pointers.newPtr = `@meta:FCO`;
        await importer.apply(node, original);
        assert.equal(core.getPointerPath(node, "newPtr"), nodePath);
      });

      it("should delete pointer", async function () {
        delete original2.pointers.base;
        await importer.apply(node2, original2);
        assert.equal(core.getPointerPath(node2, "base"), null);
      });

      it("should set pointer to null", async function () {
        original2.pointers.existingPtr = null;
        await importer.apply(node2, original2);
        assert.equal(core.getPointerPath(node2, "existingPtr"), null);
      });

      it("should change pointer", async function () {
        const nodePath = core.getPath(node3);
        original2.pointers.base = nodePath;
        await importer.apply(node2, original2);
        assert.equal(core.getPointerPath(node2, "base"), nodePath);
      });

      it("should preserve children on base change", async function () {
        const childNode = core.createNode({ base: fco, parent: node2 });
        const childPath = core.getPath(childNode);
        core.setAttribute(childNode, "name", "ChildNode");
        original2 = await importer.toJSON(node2);
        const nodePath = core.getPath(node3);
        original2.pointers.base = nodePath;

        await importer.apply(node2, original2);
        assert.equal(core.getPointerPath(node2, "base"), nodePath);
        assert(
          core.getChildrenPaths(node2).includes(childPath),
          `Child node not present after changing the base`,
        );
      });

      it("should resolve @meta tag even if renamed during changes", async function () {
        const fco = await core.loadByPath(root, "/1");
        const metanode = core.createNode({ base: fco, parent: root });
        core.setAttribute(metanode, "name", "MetaNode");
        core.addMember(root, "MetaAspectSet", metanode);
        const container = core.createNode({ base: fco, parent: root });
        const node = core.createNode({ base: fco, parent: container });
        core.setAttribute(node, "name", "testNode");

        const newJSON = {
          children: [
            {
              id: "@meta:MetaNode",
              attributes: {
                name: "NewMetaNodeName",
              },
            },
            {
              id: "@name:testNode",
              pointers: {
                base: "@meta:MetaNode",
                testPtr: "@meta:MetaNode",
              },
            },
          ],
        };

        await importer.apply(container, newJSON);
        assert.equal(
          core.getAttribute(metanode, "name"),
          "NewMetaNodeName",
        );
        assert.equal(
          core.getPointerPath(node, "testPtr"),
          core.getPath(metanode),
        );
      });

      it("should resolve @meta tag when library prefix used", async function () {
        const node = core.createNode({ parent: root, base: fco });
        core.setAttribute(node, "name", "libPrefixTest");
        const state = {
          pointers: {
            base: "@meta:FCO",
            ptr: "@meta:myLibrary.A",
          },
        };
        await importer.apply(node, state);
        const libraryAPath = "/f/n";
        assert.equal(core.getPointerPath(node, "ptr"), libraryAPath);
      });

      it("should set base correctly during structural inheritance", async function () {
        // Create nodes: A, B, and A' where
        //   - B is contained in A
        //   - A' inherits from A
        //
        // Check that:
        //   - B' exists (ie, it is created)
        //   - B' inherits from B
        const fco = await core.loadByPath(root, "/1");
        const nodeA = core.createNode({ base: fco, parent: root });
        core.setAttribute(nodeA, "name", "A");

        const nodeB = core.createNode({ base: fco, parent: nodeA });
        core.setAttribute(nodeB, "name", "B");

        const nodeAp = core.createNode({ base: nodeA, parent: root });
        core.setAttribute(nodeAp, "name", "A prime");

        const [childPath] = core.getChildrenPaths(nodeAp);
        const nodeBp = await core.loadByPath(root, childPath);

        const schemaAp = await importer.toJSON(nodeAp);
        const [schemaBp] = schemaAp.children;
        assert.equal(schemaBp.pointers.base, core.getGuid(nodeB));
      });
    });

    describe("pointer meta", function () {
      beforeEach(async () => {
        core.setPointerMetaLimits(node2, "myPtr", 1, 1);
        core.setPointerMetaTarget(node2, "myPtr", node3, -1, 1);
        core.setPointerMetaTarget(node2, "myPtr", node2, -1, 1);
        original2 = await importer.toJSON(node2);
      });

      it("should add pointer meta", async function () {
        const nodePath = core.getPath(node3);
        const ptrMeta = { min: 1, max: 1 };
        ptrMeta[nodePath] = { min: -1, max: 1 };

        original2.pointer_meta.newPtr = ptrMeta;
        await importer.apply(node2, original2);
        assert.deepEqual(core.getPointerMeta(node2, "newPtr"), ptrMeta);
      });

      it("should delete pointer meta", async function () {
        delete original2.pointer_meta.myPtr;
        await importer.apply(node2, original2);
        assert.equal(core.getPointerMeta(node2, "myPtr"), undefined);
      });

      it("should delete pointer meta target", async function () {
        const nodePath = core.getPath(node2);
        const nodeGuid = core.getGuid(node2);
        delete original2.pointer_meta.myPtr[nodeGuid];
        await importer.apply(node2, original2);
        const meta = core.getPointerMeta(node2, "myPtr");
        assert.equal(meta[nodePath], undefined);
        assert.notEqual(meta[core.getPath(node3)], undefined);
      });

      it("should update pointer target limits", async function () {
        const nodeGuid = core.getGuid(node2);
        original2.pointer_meta.myPtr[nodeGuid].min = 1;
        await importer.apply(node2, original2);
        const meta = core.getPointerMeta(node2, "myPtr");
        const nodePath = core.getPath(node2);
        assert.equal(meta[nodePath].min, 1);
      });

      it("should update pointer limits", async function () {
        original2.pointer_meta.myPtr.min = -1;
        await importer.apply(node2, original2);
        const meta = core.getPointerMeta(node2, "myPtr");
        assert.equal(meta.min, -1);
      });

      it("should add target to existing pointer", async function () {
        const nodeId = core.getPath(node);
        original2.pointer_meta.myPtr[nodeId] = { min: -1, max: 1 };
        await importer.apply(node2, original2);
        const meta = core.getPointerMeta(node2, "myPtr");
        assert.deepEqual(meta[nodeId], { min: -1, max: 1 });
        assert.notEqual(meta[core.getPath(node2)], undefined);
      });
    });

    describe("children meta", function () {
      beforeEach(async () => {
        core.setPointerMetaLimits(node2, "myPtr", 1, 1);
        core.setPointerMetaTarget(node2, "myPtr", node3, -1, 1);
        core.setPointerMetaTarget(node2, "myPtr", node2, -1, 1);
        original2 = await importer.toJSON(node2);
      });

      it("should include children_meta", async function () {
        core.setChildMeta(node2, node3);
        const json = await importer.toJSON(node2);
        const nodeGuid = core.getGuid(node3);
        assert.deepEqual(json.children_meta[nodeGuid], {
          min: -1,
          max: -1,
        });
      });

      it("should include children_meta w/ limits", async function () {
        core.setChildMeta(node2, node3, 2, 5);
        const json = await importer.toJSON(node2);
        const nodeGuid = core.getGuid(node3);
        assert.deepEqual(json.children_meta[nodeGuid], {
          min: 2,
          max: 5,
        });
      });

      it("should include children limits", async function () {
        core.setChildMeta(node2, node3);
        core.setChildrenMetaLimits(node2, 1, 4);
        const json = await importer.toJSON(node2);
        const nodeId = core.getPath(node3);
        assert.equal(json.children_meta.min, 1);
        assert.equal(json.children_meta.max, 4);
      });

      it("should set child type limit", async function () {
        const nodeId = core.getPath(node3);
        original2.children_meta = { min: -1, max: -1 };
        original2.children_meta[nodeId] = { min: -1, max: 1 };
        await importer.apply(node2, original2);
        assert.deepEqual(core.getChildrenMeta(node2)[nodeId], {
          min: -1,
          max: 1,
        });
      });

      it("should set child limit", async function () {
        const nodeId = core.getPath(node3);
        original2.children_meta = { min: 4, max: 9 };
        original2.children_meta[nodeId] = { min: -1, max: 1 };
        await importer.apply(node2, original2);
        assert.equal(core.getChildrenMeta(node2).min, 4);
        assert.equal(core.getChildrenMeta(node2).max, 9);
      });

      it("should clear containment rules", async function () {
        core.setChildMeta(node2, node3);
        core.setChildrenMetaLimits(node2, 1, 4);
        const json = await importer.toJSON(node2);
        json.children_meta = {};

        await importer.apply(node2, json);
        assert.equal(core.getChildrenMeta(node2), null);
      });

      it("should remove valid child type", async function () {
        core.setChildMeta(node2, node3);
        const json = await importer.toJSON(node2);
        const nodeGuid = core.getGuid(node3);
        delete json.children_meta[nodeGuid];

        await importer.apply(node2, json);
        assert.equal(core.getChildrenMeta(node2), null);
      });
    });

    describe("mixins", function () {
      let node4;

      beforeEach(() => {
        const base = node;
        const parent = root;
        node4 = core.createNode({ base, parent });
        core.setAttribute(node4, "name", "Node4");
        core.addMember(root, "MetaAspectSet", node4);
      });

      it("should add mixin", async function () {
        const nodeId = core.getPath(node4);
        original2.mixins.push(nodeId);
        await importer.apply(node2, original2);
        const mixins = core.getMixinPaths(node2);
        assert(mixins.includes(nodeId));
        assert.equal(mixins.length, 1);
      });

      it("should remove mixin", async function () {
        const nodeId = core.getPath(node4);
        core.addMixin(node2, nodeId);
        await importer.apply(node2, original2);
        const mixins = core.getMixinPaths(node2);
        assert.equal(mixins.length, 0);
      });

      it("should change mixin", async function () {
        const node5 = core.createNode({ base: node, parent: root });
        core.setAttribute(node5, "name", "Node5");
        core.addMember(root, "MetaAspectSet", node5);

        const nodeId = core.getPath(node4);
        core.addMixin(node2, nodeId);
        original2.mixins.push(core.getPath(node5));
        await importer.apply(node2, original2);
        const mixins = core.getMixinPaths(node2);
        assert.deepEqual(mixins, original2.mixins);
      });

      it("should add mixin using ID", async function () {
        original2.mixins.push("@meta:Node4");
        await importer.apply(node2, original2);
        const mixins = core.getMixinPaths(node2);
        const nodeId = core.getPath(node4);
        assert(mixins.includes(nodeId));
        assert.equal(mixins.length, 1);
      });

      it("should throw error on invalid mixin", async function () {
        original2.mixins.push("@meta:FCO");
        await assert.rejects(
          () => importer.apply(node2, original2),
          /Cannot set .* as mixin/,
        );
      });
    });

    describe("sets", function () {
      const setName = "someSet";
      let node4;

      beforeEach(async () => {
        node4 = core.createNode({ base: node, parent: root });
        core.setAttribute(node4, "name", "Node4");

        core.setPointerMetaLimits(node2, setName, -1, -1);
        core.setPointerMetaTarget(node2, setName, node3, -1, -1);
        core.setPointerMetaTarget(node2, setName, node4, -1, -1);

        core.addMember(node2, setName, node3);
        original2 = await importer.toJSON(node2);
      });

      it("should add member", async function () {
        const nodeId = core.getPath(node4);
        original2.sets[setName].push(nodeId);
        await importer.apply(node2, original2);
        const members = core.getMemberPaths(node2, setName);
        assert(members.includes(nodeId));
        assert.equal(members.length, 2);
      });

      it("should add member to new set", async function () {
        const nodeId = core.getPath(node4);
        const setName = "newSet";
        original2.sets[setName] = [nodeId];
        await importer.apply(node2, original2);
        const members = core.getMemberPaths(node2, setName);
        assert(members.includes(nodeId));
        assert.equal(members.length, 1);
        assert(core.getSetNames(node2).includes(setName));
      });

      it("should remove member", async function () {
        core.addMember(node2, setName, node4);
        original2 = await importer.toJSON(node2);

        original2.sets[setName].pop();
        const newMembers = original2.sets[setName].slice();
        await importer.apply(node2, original2);
        const members = core.getMemberPaths(node2, setName);
        assert.equal(members.length, 1);
        const [memberPath] = members;
        const member = await core.loadByPath(root, memberPath);
        assert.equal(core.getGuid(member), newMembers[0]);
      });

      it("should create empty set", async function () {
        const setName = "newSet";
        original2.sets[setName] = [];
        await importer.apply(node2, original2);
        const members = core.getMemberPaths(node2, setName);
        assert.equal(members.length, 0);
        assert(core.getSetNames(node2).includes(setName));
      });

      it("should delete set", async function () {
        delete original2.sets[setName];
        await importer.apply(node2, original2);
        assert(!core.getSetNames(node2).includes(setName));
      });

      describe("attributes", function () {
        const attrName = "myAttr";
        let nodeGuid, nodePath;
        beforeEach(async () => {
          nodePath = core.getPath(node3);
          nodeGuid = core.getGuid(node3);
          core.setMemberAttribute(
            node2,
            setName,
            nodePath,
            attrName,
            "hello",
          );
          original2 = await importer.toJSON(node2);
        });

        it("should set member attributes", async function () {
          original2.member_attributes[setName][nodeGuid][attrName] = "world";
          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberAttribute(
              node2,
              setName,
              nodePath,
              attrName,
            ),
            "world",
          );
        });

        it("should set new member attributes", async function () {
          const nodeId = core.getPath(node4);
          original2.sets[setName] = [nodeId];
          original2.member_attributes[setName][nodeId] = {};
          original2.member_attributes[setName][nodeId][attrName] = "world";

          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberAttribute(
              node2,
              setName,
              nodeId,
              attrName,
            ),
            "world",
          );
        });

        it("should set member attribute on new set", async function () {
          const nodeId = core.getPath(node4);
          original2.sets[setName] = [nodeId];
          original2.member_attributes[setName][nodeId] = {};
          original2.member_attributes[setName][nodeId][attrName] = "world";

          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberAttribute(
              node2,
              setName,
              nodeId,
              attrName,
            ),
            "world",
          );
        });

        it("should delete member attributes", async function () {
          delete original2.member_attributes[setName][nodeGuid][
            attrName
          ];
          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberAttribute(
              node2,
              setName,
              nodePath,
              attrName,
            ),
            undefined,
          );
        });

        it("should delete all member attributes for set", async function () {
          core.setMemberAttribute(
            node2,
            setName,
            nodePath,
            "attr2",
            "world",
          );
          original2 = await importer.toJSON(node2);

          delete original2.member_attributes[setName][nodeGuid];
          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberAttribute(
              node2,
              setName,
              nodePath,
              attrName,
            ),
            undefined,
          );
          assert.equal(
            core.getMemberAttribute(
              node2,
              setName,
              nodePath,
              "attr2",
            ),
            undefined,
          );
        });

        it("should delete all member attributes when member removed", async function () {
          core.setMemberAttribute(
            node2,
            setName,
            nodePath,
            "attr2",
            "world",
          );
          original2 = await importer.toJSON(node2);

          // remove member from set
          original2.sets[setName] = [];
          delete original2.member_attributes[setName][nodeGuid];
          delete original2.member_registry[setName][nodeGuid];

          await importer.apply(node2, original2);
        });
      });

      describe("registry", function () {
        const regName = "myReg";
        let nodePath;
        let nodeGuid;
        beforeEach(async () => {
          nodePath = core.getPath(node3);
          nodeGuid = core.getGuid(node3);
          const position = { x: 1, y: 2 };
          core.setMemberRegistry(
            node2,
            setName,
            nodePath,
            regName,
            position,
          );
          original2 = await importer.toJSON(node2);
        });

        it("should set member registry values", async function () {
          original2.member_registry[setName][nodeGuid][regName] = "world";
          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberRegistry(
              node2,
              setName,
              nodePath,
              regName,
            ),
            "world",
          );
        });

        it("should set new member registry values", async function () {
          const nodePath = core.getPath(node4);
          original2.sets[setName] = [nodePath];
          original2.member_registry[setName][nodePath] = {};
          original2.member_registry[setName][nodePath][regName] = "world";

          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberRegistry(
              node2,
              setName,
              nodePath,
              regName,
            ),
            "world",
          );
        });

        it("should set member registry on new set", async function () {
          const nodePath = core.getPath(node4);
          original2.sets[setName] = [nodePath];
          original2.member_registry[setName][nodePath] = {};
          original2.member_registry[setName][nodePath][regName] = "world";

          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberRegistry(
              node2,
              setName,
              nodePath,
              regName,
            ),
            "world",
          );
        });

        it("should delete member registry values", async function () {
          delete original2.member_registry[setName][nodeGuid][
            regName
          ];
          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberRegistry(
              node2,
              setName,
              nodePath,
              regName,
            ),
            undefined,
          );
        });

        it("should delete all member registry values for set", async function () {
          core.setMemberRegistry(
            node2,
            setName,
            nodePath,
            "attr2",
            "world",
          );
          original2 = await importer.toJSON(node2);

          delete original2.member_registry[setName][nodeGuid];
          await importer.apply(node2, original2);
          assert.equal(
            core.getMemberRegistry(
              node2,
              setName,
              nodePath,
              regName,
            ),
            undefined,
          );
          assert.equal(
            core.getMemberRegistry(
              node2,
              setName,
              nodePath,
              "attr2",
            ),
            undefined,
          );
        });

        it("should set nested member registry", async function () {
          original2.member_registry[setName][nodeGuid][regName].x = 3;
          await importer.apply(node2, original2);
          const newPosition = core.getMemberRegistry(
            node2,
            setName,
            nodePath,
            regName,
          );
          assert.equal(newPosition.x, 3);

          assert.equal(newPosition.y, 2);
        });
      });
    });

    describe("child nodes", function () {
      it("should create nodes", async function () {
        const nodeId = core.getPath(node3);
        original2.children.push({
          attributes: { name: "NewChild" },
          pointers: { base: nodeId },
        });
        await importer.apply(node2, original2);
        const children = await core.loadChildren(node2);
        assert.equal(children.length, 1);
        assert.equal(
          core.getAttribute(children[0], "name"),
          "NewChild",
        );
      });

      it("should set @name if tag not found", async function () {
        const nodeId = core.getPath(node3);
        original2.children.push({
          id: "@name:NewChild",
          pointers: { base: nodeId },
        });
        await importer.apply(node2, original2);
        const children = await core.loadChildren(node2);
        assert.equal(children.length, 1);
        assert.equal(
          core.getAttribute(children[0], "name"),
          "NewChild",
        );
      });

      it("should set @attribute if tag not found", async function () {
        const nodeId = core.getPath(node3);
        original2.children.push({
          id: "@attribute:testAttr:NewChild",
          pointers: { base: nodeId },
        });
        await importer.apply(node2, original2);
        const children = await core.loadChildren(node2);
        assert.equal(children.length, 1);
        assert.equal(
          core.getAttribute(children[0], "testAttr"),
          "NewChild",
        );
      });

      it("should match nodes existing nodes", async function () {
        const newNode = core.createNode({ base: node3, parent: node2 });
        core.setAttribute(newNode, "name", "NewChild");
        original2.children.push({
          id: "@name:NewChild",
          attributes: { name: "SomeNewName" },
        });
        await importer.apply(node2, original2);
        const children = await core.loadChildren(node2);
        assert.equal(children.length, 1);
        assert.equal(
          core.getAttribute(children[0], "name"),
          "SomeNewName",
        );
      });

      it("should delete nodes not in json", async function () {
        const newNode = core.createNode({ base: node3, parent: node2 });
        core.setAttribute(newNode, "name", "NewChild");

        const newNode2 = core.createNode({
          base: node3,
          parent: node2,
        });
        core.setAttribute(newNode2, "name", "NewChild2");

        original2.children.push({
          id: "@name:NewChild",
          attributes: { name: "SomeNewName" },
        });

        await importer.apply(node2, original2);
        const children = await core.loadChildren(node2);
        assert.equal(children.length, 1);
        assert.equal(
          core.getAttribute(children[0], "name"),
          "SomeNewName",
        );
      });

      it('should ignore children if no "children" field', async function () {
        const newNode = core.createNode({ base: node3, parent: node2 });
        core.setAttribute(newNode, "name", "NewChild");
        delete original2.children;
        await importer.apply(node2, original2);
        const [child] = await core.loadChildren(node2);
        assert(!!child);
        assert.equal(core.getGuid(child), core.getGuid(newNode));
      });
    });
  });

  describe("guid", function () {
    it("should set guid for new nodes", async function () {
      const fco = await core.loadByPath(root, "/1");
      const guid = "0d2e0ef3-5b8f-9bc4-45a0-8abab4433565";
      const container = {
        guid,
      };
      const containerNode = await importer.import(root, container);
      assert.equal(
        core.getGuid(containerNode),
        guid,
        "Did not set guid on creation",
      );
    });

    it("should change guid for existing nodes", async function () {
      const fco = await core.loadByPath(root, "/1");
      const node = core.createNode({ base: fco, parent: root });
      const guid = "0d2e0ef3-5b8f-9bc4-45a0-8abab4433565";
      const nodeJson = {
        guid,
      };
      await importer.apply(node, nodeJson);
      assert.equal(core.getGuid(node), guid, "Did not change guid");
    });
  });

  describe("findNode", function () {
    it("should find nodes using @meta", async function () {
      const fco = await importer.findNode(node, "@meta:FCO");
      assert.equal(fco, node);
    });

    it("should find nodes using @name", async function () {
      const fco = await importer.findNode(root, "@name:FCO");
      assert.equal(fco, node);
    });

    it("should not find nodes outside parent", async function () {
      const fco = await importer.findNode(node, "@name:FCO");
      assert.equal(fco, undefined);
    });
  });

  describe("selectors", function () {
    it("should find new inherited children using @name", async function () {
      const fco = await core.loadByPath(root, "/1");
      const base = core.createNode({ parent: root, base: fco });
      const baseChild = core.createNode({ parent: base, base: fco });
      core.setAttribute(baseChild, "name", "TestChild");

      const newNodeState = {
        pointers: { base: core.getPath(base) },
        children: [
          {
            id: "@name:TestChild",
            attributes: { name: "InheritedChild" },
          },
        ],
      };
      const newNode = await importer.import(root, newNodeState);
      assert.equal(
        core.getChildrenPaths(newNode).length,
        1,
        "Created extra child node",
      );
    });

    it("should resolve @id", async function () {
      const container = {
        attributes: { name: "test" },
        children: [],
      };
      container.children.push(
        {
          id: "@id:child1",
          attributes: { name: "child" },
        },
        {
          attributes: { name: "otherChild" },
          pointers: { base: "@id:child1" },
        },
      );
      await importer.import(root, container);
      const containerNode = (await core.loadChildren(root)).find(
        (node) => core.getAttribute(node, "name") === "test",
      );
      assert(containerNode, "Container not created");
      const childNodes = await core.loadChildren(containerNode);
      assert(childNodes.length, "Child nodes not created");
      const [[child], [otherChild]] = _.partition(
        childNodes,
        (node) => core.getAttribute(node, "name") === "child",
      );

      assert.equal(
        core.getPath(child),
        core.getPointerPath(otherChild, "base"),
        "@id tag not resolved to sibling node",
      );
    });

    it("should resolve @id to alias", async function () {
      const fco = await core.loadByPath(root, "/1");
      const state = {
        children: [
          {
            id: "@name:Hello",
            alias: "test",
          },
          {
            children: [{ pointers: { base: "@id:test" } }],
          },
        ],
      };

      const container = core.createNode({ base: fco, parent: root });
      const helloNode = core.createNode({ base: fco, parent: container });
      core.setAttribute(helloNode, "name", "Hello");
      const helloGuid = core.getGuid(helloNode);
      await importer.apply(container, state);

      const children = await core.loadChildren(container);
      const [[newHelloNode], [otherNode]] = _.partition(
        children,
        (child) => core.getAttribute(child, "name") === "Hello",
      );
      assert(newHelloNode);
      assert.equal(helloGuid, core.getGuid(newHelloNode));
      const [instanceNode] = await core.loadChildren(otherNode);
      assert.equal(core.getBase(instanceNode), newHelloNode);
    });

    it("should resolve @id when used before target's DFS order", async () => {
      const container = {
        attributes: { name: "test" },
        children: [],
      };
      container.children.push(
        {
          attributes: { name: "otherChild" },
          pointers: { base: "@id:child1" },
        },
        {
          id: "@id:child1",
          attributes: { name: "child" },
        },
      );
      await importer.import(root, container);
      const containerNode = (await core.loadChildren(root)).find(
        (node) => core.getAttribute(node, "name") === "test",
      );
      assert(containerNode, "Container not created");
      const childNodes = await core.loadChildren(containerNode);
      assert(childNodes.length, "Child nodes not created");
      const [[child], [otherChild]] = _.partition(
        childNodes,
        (node) => core.getAttribute(node, "name") === "child",
      );

      assert.equal(
        core.getPointerPath(otherChild, "base"),
        core.getPath(child),
        "@id tag not resolved to sibling node",
      );
    });

    it("should resolve @guid", async function () {
      const fco = await core.loadByPath(root, "/1");
      const node = core.createNode({ base: fco, parent: root });
      core.setAttribute(node, "name", "MyNode!");
      const guid = core.getGuid(node);
      const container = {
        attributes: { name: "guidtest" },
        pointers: {
          base: core.getPath(fco),
          test: "@guid:" + guid,
        },
      };
      const containerNode = await importer.import(root, container);
      assert.equal(
        core.getPointerPath(containerNode, "test"),
        core.getPath(node),
        "Did not resolve guid",
      );
    });

    it("should detect @guid", async function () {
      const fco = await core.loadByPath(root, "/1");
      const node = core.createNode({ base: fco, parent: root });
      core.setAttribute(node, "name", "MyNode!");
      const guid = core.getGuid(node);
      const container = {
        attributes: { name: "guidtest" },
        pointers: {
          base: core.getPath(fco),
          test: guid,
        },
      };
      const containerNode = await importer.import(root, container);
      assert.equal(
        core.getPointerPath(containerNode, "test"),
        core.getPath(node),
        "Did not resolve guid",
      );
    });

    it("should search children for @guid first", async function () {
      const fco = await core.loadByPath(root, "/1");
      const parent = core.createNode({ base: fco, parent: root });
      const node = core.createNode({ base: fco, parent });
      const guid = core.getGuid(node);

      const parentJson = {
        children: [
          {
            id: `@guid:${guid}`,
          },
        ],
      };
      const selectors = new NodeSelections();
      await importer.resolveSelectorsForExistingNodes(
        parent,
        parentJson,
        selectors,
      );
      assert.equal(selectors.cache.length, 1);
    });

    it("should search children of ancestors for @guid next", async function () {
      const fco = await core.loadByPath(root, "/1");
      const gparent = core.createNode({ base: fco, parent: root });
      const parent = core.createNode({ base: fco, parent: gparent });
      const node = core.createNode({ base: fco, parent: gparent });
      const guid = core.getGuid(node);

      const parentJson = {
        children: [
          {
            id: `@guid:${guid}`,
          },
        ],
      };
      const selectors = new NodeSelections();
      await importer.resolveSelectorsForExistingNodes(
        parent,
        parentJson,
        selectors,
      );
      assert.equal(selectors.cache.length, 2);
    });

    it("should set guid when creating @guid nodes", async function () {
      const fco = await core.loadByPath(root, "/1");
      const node = core.createNode({ base: fco, parent: root });
      core.setAttribute(node, "name", "MyNode!");
      const guid = "0d2e0ef3-5b8f-9bc4-45a0-8abab4433565";
      const container = {
        id: `@guid:${guid}`,
        attributes: { name: "newguidtest" },
      };
      const containerNode = await importer.import(root, container);
      assert.equal(
        core.getGuid(containerNode),
        guid,
        "Did not set guid on creation",
      );
    });

    it("should set path when creating @path nodes", async function () {
      const fco = await core.loadByPath(root, "/1");
      const node = core.createNode({ base: fco, parent: root });
      core.setAttribute(node, "name", "MyNode!");
      const path = "testPath";
      const container = {
        id: `@path:${path}`,
        attributes: { name: "newpathtest" },
      };
      const containerNode = await importer.import(root, container);
      assert.equal(
        core.getPath(containerNode).split("/").pop(),
        path,
        "Did not set path on creation",
      );
    });

    it('should set path when "path" set', async function () {
      const fco = await core.loadByPath(root, "/1");
      const node = core.createNode({ base: fco, parent: root });
      core.setAttribute(node, "name", "MyNode!");
      const path = "testPath";
      const container = {
        path,
        attributes: { name: "newpathtest2" },
      };
      const containerNode = await importer.import(root, container);
      assert.equal(
        core.getPath(containerNode).split("/").pop(),
        path,
        "Did not set path on creation",
      );
    });

    it("should not have collisions for auto-gen IDs", async function () {
      const fco = await core.loadByPath(root, "/1");
      const container = core.createNode({ base: fco, parent: root });
      const childCount = 1000;
      const schema = {
        children: [...new Array(childCount)].map(() => ({})),
      };
      await importer.apply(container, schema);
      assert.equal(childCount, core.getChildrenPaths(container).length);
    });

    describe("prepare", function () {
      it("should add @meta node to META", async function () {
        const selector = new Importer.NodeSelector("@meta:TestMeta");
        const fco = await core.loadByPath(root, "/1");
        const node = core.createNode({ base: fco, parent: root });
        await selector.prepare(core, root, node);

        const meta = await core.getAllMetaNodes(root);
        assert(meta[core.getPath(node)], "New node not in the meta");
      });

      it("should add @meta node to META sheet", async function () {
        const selector = new Importer.NodeSelector(
          "@meta:TestMetaSheet",
        );
        const fco = await core.loadByPath(root, "/1");
        const node = core.createNode({ base: fco, parent: root });
        await selector.prepare(core, root, node);

        const metaSetName = "MetaAspectSet";
        const metaSheetSetName = core
          .getSetNames(root)
          .find(
            (name) => name.startsWith(metaSetName) && name !== metaSetName,
          );
        const memberPaths = core.getMemberPaths(root, metaSheetSetName);
        assert(memberPaths.includes(core.getPath(node)));
      });
    });
  });

  describe("import", function () {
    let children;

    before(async () => {
      root = await getNewRootNode(core);
      importer = new Importer(core, root);

      const state = { attributes: { name: "hello" } };
      await importer.import(root, state);
      children = await core.loadChildren(root);
    });

    it("should not apply changes to parent", function () {
      assert.notEqual(core.getAttribute(root, "name"), "hello");
    });

    it("should create new node", async function () {
      assert.equal(children.length, 3);
    });

    it("should apply changes to new node", async function () {
      const newNode = children.find(
        (node) => core.getAttribute(node, "name") === "hello",
      );
      assert(newNode);
    });
  });

  describe("omits", function () {
    before(async () => {
      root = await getNewRootNode(core);
      importer = new Importer(core, root);
      const state = { attributes: { name: "hello" } };
      await importer.import(root, state);
    });

    it("should omit children in toJSON", async function () {
      const json = await importer.toJSON(
        root,
        new OmittedProperties(["children"]),
      );
      assert(json.children === undefined);
    });

    it("should omit pointers in toJSON", async function () {
      const json = await importer.toJSON(
        root,
        new OmittedProperties(["pointers"]),
      );
      assert(json.pointers === undefined);
    });

    it("should omit sets and associated attributes in toJSON", async function () {
      const omitProps = new OmittedProperties(["sets"]);
      const json = await importer.toJSON(
        root,
        omitProps.withRelatedProperties(),
      );
      ["sets", "member_attributes", "member_registry"].forEach((attr) =>
        assert(json[attr] === undefined)
      );
    });

    it("should omit only member_registry", async function () {
      const json = await importer.toJSON(
        root,
        new OmittedProperties(["member_registry"]),
      );
      assert(json.member_registry === undefined);
    });

    it("should omit only attributes", async function () {
      const json = await importer.toJSON(
        root,
        new OmittedProperties(["attributes"]),
      );
      assert(json.attributes === undefined);
    });

    it("should omit only attribute_meta", async function () {
      const json = await importer.toJSON(
        root,
        new OmittedProperties(["attribute_meta"]),
      );
      assert(json.attribute_meta === undefined);
    });
  });

  describe("omitted properties", function () {
    it("should filter related properties for sets", () => {
      const wjiOmittedProperties = new OmittedProperties(["sets"]);
      assert(
        wjiOmittedProperties
          .withRelatedProperties()
          .has("member_registry"),
      );
      assert(
        wjiOmittedProperties
          .withRelatedProperties()
          .has("member_attributes"),
      );
    });

    it("should filter related properties for children", () => {
      const omittedWJIProperties = new OmittedProperties(["children"]);
      assert(
        omittedWJIProperties
          .withRelatedProperties()
          .has("children_meta"),
      );
    });

    it("should throw an error for invalid properties", () => {
      try {
        new OmittedProperties(["id"]);
      } catch (e) {
        assert(e.message.includes("Invalid properties to omit"));
      }
    });
  });

  describe("diff", function () {
    let node1;
    beforeEach(async function () {
      node1 = core.createNode({
        parent: root,
        base: fco,
      });
    });

    it("should find a single diff on attribute addition", async () => {
      core.setAttribute(node1, "name", "New Name");
      const state = await importer.toJSON(node1);
      core.delAttribute(node1, "name");
      const diffs = await importer.diff(node1, state);

      assert.equal(diffs.length, 1, "more than once diff found");
      const diff = diffs.shift();
      const [type, name] = diff.key;
      assert(diff.type === "put");
      assert(type === "attributes");
      assert(name === "name");
      assert(diff.value === "New Name");
    });

    it("should find put children diff type on children addition", async () => {
      const state = {
        children: [
          {
            attributes: {
              attr1: "attr1",
            },
          },
        ],
      };

      const diff = (await importer.diff(node1, state)).shift();
      assert(
        diff.type === "put" && diff.key[0] === "children",
        "put children diff not found",
      );
    });

    it("should find del children diff type on children removal", async () => {
      range(5).forEach((idx) => {
        const node = core.createNode({
          parent: node1,
          base: fco,
        });
        core.setAttribute(node, "name", `child${idx}`);
      });

      const state = await importer.toJSON(node1);
      state.children.splice(0, 2);

      const diffs = await importer.diff(node1, state);
      assert(diffs.length === 2);
      assert(
        diffs.every(
          (diff) => diff.type === "del" && diff.key[0] === "children",
        ),
      );
    });

    it("should find pointer changes in diff by path", async () => {
      range(5).forEach((idx) => {
        const node = core.createNode({
          parent: node1,
          base: fco,
        });
        core.setAttribute(node, "name", `child${idx}`);
      });

      const node2 = core.createNode({
        parent: root,
        base: fco,
      });

      const state = await importer.toJSON(node1);
      state.children.forEach(
        (child) => (child.pointers.base = core.getPath(node2)),
      );

      const diffs = await importer.diff(node1, state);
      assert(diffs.length === 5, "more than 5 diffs found");
      assert(
        diffs.every((diff) => {
          const diffType = diff.type;
          const [type, name] = diff.key;
          const value = diff.value;
          return (
            diffType === "put" &&
            type === "pointers" &&
            name === "base" &&
            value === core.getPath(node2)
          );
        }),
      );
    });
  });

  describe("patch", function () {
    let node1, children;
    beforeEach(async function () {
      node1 = core.createNode({
        parent: root,
        base: fco,
      });
      children = range(5).map((idx) => {
        const node = core.createNode({
          parent: node1,
          base: fco,
        });
        core.setAttribute(node, "name", `child${idx}`);
        return node;
      });
    });

    it("should apply attribute changeset to appropriate node in the subtree (@path)", async () => {
      const changeSets = [
        new NodeChangeSet(
          core.getPath(node1),
          core.getPath(children[0]),
          "put",
          ["attributes", "name"],
          "changedNameChild0",
        ),
        new NodeChangeSet(
          core.getPath(node1),
          core.getPath(children[3]),
          "put",
          ["attributes", "name"],
          "changedNameChild3",
        ),
      ];
      await importer.patch(node1, changeSets);
      assert.equal(
        core.getAttribute(children[0], "name"),
        "changedNameChild0",
      );
      assert.equal(
        core.getAttribute(children[3], "name"),
        "changedNameChild3",
      );
    });

    it("should apply attribute changeset to appropriate node in the subtree (@guid)", async () => {
      const changeSets = [
        new NodeChangeSet(
          core.getPath(node1),
          core.getGuid(children[0]),
          "put",
          ["attributes", "name"],
          "changedNameChild0",
        ),
        new NodeChangeSet(
          core.getPath(node1),
          core.getGuid(children[3]),
          "put",
          ["attributes", "name"],
          "changedNameChild3",
        ),
      ];

      await importer.patch(node1, changeSets);
      assert.equal(
        core.getAttribute(children[0], "name"),
        "changedNameChild0",
      );
      assert.equal(
        core.getAttribute(children[3], "name"),
        "changedNameChild3",
      );
    });

    it("should apply base pointer changeset to appropriate node in the subtree (@guid)", async () => {
      const node2 = core.createNode({
        parent: node1,
        base: fco,
      });

      core.setAttribute(node2, "name", "newName");

      const changeSets = [
        new NodeChangeSet(
          core.getPath(node1),
          core.getGuid(children[3]),
          "put",
          ["pointers", "base"],
          core.getGuid(node2),
        ),
      ];

      await importer.patch(node1, changeSets);
      assert(
        core.getPointerPath(children[3], "base") === core.getPath(node2),
      );
    });
  });
});

function range(size, startAt = 0) {
  return [...Array(size).keys()].map((i) => i + startAt);
}
