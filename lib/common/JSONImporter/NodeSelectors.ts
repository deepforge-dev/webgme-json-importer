import { assert, Constants } from "./Utils";

export class NodeSelector {
  tag: string;
  value: string | string[];

  constructor(idString = "") {
    if (idString.startsWith("/")) {
      this.tag = "@path";
      this.value = idString;
    } else if (idString.startsWith("@")) {
      const data = idString.split(":");
      const tag = data[0];
      if (tag === "@name") {
        data.splice(0, 1, "@attribute", "name");
      }
      this.tag = data.shift() as string;
      if (data.length === 1) {
        this.value = data.shift() as string;
      } else {
        this.value = [data[0], data.slice(1).join(":")];
      }
    } else {
      this.tag = "@guid";
      this.value = idString;
    }
  }

  prepareCreateParams(params: any) {
    if (this.tag === "@guid") {
      params.guid = this.value;
    }

    if (this.tag === "@path") {
      params.relid = (this.value as string).split("/").pop();
    }
    return params;
  }

  async prepare(core: GmeClasses.Core, rootNode: Core.Node, node: Core.Node) {
    if (this.tag === "@attribute") {
      const [attr, value] = this.value;
      core.setAttribute(node, attr, value);
    }

    if (this.tag === "@meta") {
      core.setAttribute(node, "name", this.value as string);

      const metaSheetSet = core
        .getSetNames(rootNode)
        .find(
          (name) =>
            name !== Constants.META_ASPECT_SET_NAME &&
            name.startsWith(Constants.META_ASPECT_SET_NAME),
        );

      core.addMember(rootNode, Constants.META_ASPECT_SET_NAME, node);
      core.addMember(rootNode, metaSheetSet as GmeCommon.Name, node);

      const meta = await core.getAllMetaNodes(rootNode);
      assert(meta[core.getPath(node)], "New node not in the meta");
    }
  }

  async findNode(
    core: GmeClasses.Core,
    rootNode: Core.Node,
    parent: Core.Node,
    nodeCache: NodeSelections,
  ) {
    if (this.tag === "@path") {
      return await core.loadByPath(rootNode, this.value as string);
    }

    if (this.tag === "@meta") {
      const metanodes = Object.values(core.getAllMetaNodes(rootNode));
      const libraries = core.getLibraryNames(rootNode).map((name) => {
        const libraryRoot = core.getLibraryRoot(
          rootNode,
          name,
        ) as Core.Node;
        return [core.getPath(libraryRoot), name];
      });

      const getFullyQualifiedName = (node: Core.Node) => {
        const name = core.getAttribute(node, "name");
        const path = core.getPath(node);
        const libraryPair = libraries.find(([rootPath]) =>
          path.startsWith(rootPath)
        );
        if (libraryPair) {
          const [, libraryName] = libraryPair;
          return libraryName + "." + name;
        }
        return name;
      };

      return metanodes.find((child) => {
        const name = core.getAttribute(child, "name");
        const fullName = getFullyQualifiedName(child);
        return name === this.value || fullName === this.value;
      });
    }

    if (this.tag === "@attribute") {
      const [attr, value] = this.value;
      const children = await core.loadChildren(parent);
      return children.find(
        (child) => core.getAttribute(child, attr) === value,
      );
    }

    if (this.tag === "@id" || this.tag === "@internal") {
      return null;
    }

    if (this.tag === "@guid") {
      const getCacheKey = (node) =>
        new NodeSelector(`@guid:${core.getGuid(node)}`);
      const opts = new NodeSearchOpts()
        .withCache(nodeCache, getCacheKey)
        .firstCheck(parent);

      return await this.nodeSearch(
        core,
        rootNode,
        (node) => core.getGuid(node) === this.value,
        opts,
      );
    }

    throw new Error(`Unknown tag: ${this.tag}`);
  }

  async nodeSearch(
    core: GmeClasses.Core,
    node: Core.Node,
    fn: (node: Core.Node) => boolean,
    searchOpts = new NodeSearchOpts(),
  ) {
    if (searchOpts.cache && searchOpts.cacheKey) {
      const { cache, cacheKey } = searchOpts;
      const checkNode = fn;
      fn = (node) => {
        if (checkNode(node)) {
          return true;
        } else {
          const key = cacheKey?.(node);
          const parent = core.getParent(node);
          if (parent && key) {
            if (cache) {
              cache.record(core.getPath(parent), key, node);
            }
          }
          return false;
        }
      };
    }

    let skipNodes: Core.Node[] = [];
    if (searchOpts.startHint) {
      let startNode: Core.Node | null = searchOpts.startHint;
      let match = null;
      while (startNode) {
        match = await this.findNodeWhere(
          core,
          startNode,
          fn,
          skipNodes,
        );
        if (match) {
          return match;
        }
        skipNodes.push(startNode);
        startNode = core.getParent(startNode);
      }
    }

    return await this.findNodeWhere(core, node, fn, skipNodes);
  }

  async cachedSearch(
    core: GmeClasses.Core,
    node: Core.Node,
    fn: (node: Core.Node) => boolean,
    cacheKey: (node: Core.Node) => any,
    nodeCache: NodeSelections,
  ) {
    return await this.findNodeWhere(core, node, async (node) => {
      if (fn(node)) {
        return true;
      } else {
        const key = cacheKey(node);
        const parent = core.getParent(node);
        if (parent) {
          nodeCache.record(core.getPath(parent), key, node);
        }
        return false;
      }
    });
  }

  async findNodeWhere(
    core: GmeClasses.Core,
    node: Core.Node,
    fn: (node: Core.Node) => Promise<boolean> | boolean,
    skipNodes: Core.Node[] = [],
  ) {
    if (skipNodes.includes(node)) {
      return;
    }

    if (await fn(node)) {
      return node;
    }

    const children = await core.loadChildren(node);
    for (let i = 0; i < children.length; i++) {
      const match = await this.findNodeWhere(
        core,
        children[i],
        fn,
        skipNodes,
      );
      if (match) {
        return match;
      }
    }
  }

  toString() {
    const data = Array.isArray(this.value) ? this.value : [this.value];
    return [this.tag, ...data].join(":");
  }

  isAbsolute() {
    return (
      this.tag === "@meta" ||
      this.tag === "@path" ||
      this.tag === "@id" ||
      this.tag === "@guid" ||
      this.tag === "@internal"
    );
  }
}

export class NodeSelections {
  cache: NodeCache | null = null;
  selections: { [key: string]: Core.Node };

  constructor(withCache = true) {
    this.selections = {};
    if (withCache) {
      this.cache = new NodeCache(1000);
    }
  }

  getAbsoluteTag(parentId: string, selector: NodeSelector): string {
    let absTag = selector.toString();
    if (!selector.isAbsolute()) {
      absTag = parentId + ":" + absTag;
    }
    return absTag;
  }

  record(parentId: string, selector: NodeSelector, node: Core.Node) {
    const absTag = this.getAbsoluteTag(parentId, selector);
    this.selections[absTag] = node;
  }

  get(parentId, selector): Core.Node | undefined | null {
    const cachedValue = this.cache?.get(parentId, selector);
    if (cachedValue) return cachedValue;
    return this.selections[this.getAbsoluteTag(parentId, selector)];
  }
}

class NodeCache extends NodeSelections {
  maxSize: number;
  length: number;

  constructor(maxSize) {
    super(false);
    this.maxSize = maxSize;
    this.length = 0;
  }

  record(parentId, selector, node) {
    if (this.length < this.maxSize) {
      super.record(parentId, selector, node);
      this.length++;
    }
  }

  get(parentId, selector) {
    const value = super.get(parentId, selector);
    if (value) {
      this.remove(parentId, selector);
    }
    return value;
  }

  remove(parentId, selector) {
    const absTag = this.getAbsoluteTag(parentId, selector);
    delete this.selections[absTag];
    this.length--;
  }
}

class NodeSearchOpts {
  startHint: Core.Node | null;
  cacheKey: ((node: Core.Node) => any) | null;
  cache: NodeCache | null;

  constructor() {
    this.cache = null;
    this.startHint = null;
    this.cacheKey = null;
  }

  firstCheck(startNode: Core.Node) {
    this.startHint = startNode;
    return this;
  }

  withCache(cache, cacheKey) {
    this.cache = cache;
    this.cacheKey = cacheKey;
    return this;
  }
}
