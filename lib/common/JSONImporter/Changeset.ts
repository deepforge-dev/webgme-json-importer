import _ from 'underscore';

function deepCopy<T>(source: T): T {
    return Array.isArray(source)
        ? source.map(item => deepCopy(item))
        : source instanceof Date
            ? new Date(source.getTime())
            : source && typeof source === 'object'
                ? Object.getOwnPropertyNames(source).reduce((o, prop) => {
                    Object.defineProperty(o, prop, Object.getOwnPropertyDescriptor(source, prop)!);
                    o[prop] = deepCopy((source as { [key: string]: any })[prop]);
                    return o;
                }, Object.create(Object.getPrototypeOf(source)))
                : source as T;
}


export function diff(old, new_) {
    let changes = [];

    changes = changes.concat(compare([], old, new_));

    comparing = [];
    return changes;
}


function delCheck(op) {
  if (op.type === 'put' && op.value === undefined) {
    op.type = 'del';
    delete op.value;
  }
  return op;
}

let comparing = [];
function compare(path, old, new_) {
  let changes = [];
  if (old !== null && new_ !== null &&
      typeof old === 'object' && typeof new_ === 'object' &&
      !_.contains(comparing, old)) {

    comparing.push(old);
    var oldKeys = Object.keys(old);
    var newKeys = Object.keys(new_);

    var sameKeys = _.intersection(oldKeys, newKeys);
    sameKeys.forEach(function (k) {
      var childChanges = compare(path.concat(k), old[k], new_[k]);
      changes = changes.concat(childChanges);
    });

    var delKeys = _.difference(oldKeys, newKeys);
    delKeys.reverse().forEach(function (k) {
      changes.push({ type: 'del', key: path.concat(k) });
    });

    var newKeys_ = _.difference(newKeys, oldKeys);
    newKeys_.forEach(function (k) {
      changes.push(delCheck(
        { type: 'put', key: path.concat(k), value: new_[k] }));
    });

  } else if (old !== new_) {
    changes.push(delCheck({ type: 'put', key: path, value: new_ }));
  }

  return changes;
}

export function apply(changes, target, modify) {
  var obj, clone;
  if (modify) {
    obj = target;
  } else {
    clone = deepCopy;
    obj = clone(target);
  }
  changes.forEach(function (ch) {
    var ptr, keys, len;
    switch (ch.type) {
      case 'put':
        ptr = obj;
        keys = ch.key;
        len = keys.length;
        if (len) {
          keys.forEach(function (prop, i) {
            if (!(prop in ptr)) {
              ptr[prop] = {};
            }

            if (i < len - 1) {
              ptr = ptr[prop];
            } else {
              ptr[prop] = ch.value;
            }
          });
        } else {
          obj = ch.value;
        }
        break;

      case 'del':
        ptr = obj;
        keys = ch.key;
        len = keys.length;
        if (len) {
          keys.forEach(function (prop, i) {
            if (!(prop in ptr)) {
              ptr[prop] = {};
            }

            if (i < len - 1) {
              ptr = ptr[prop];
            } else {
              if (Array.isArray(ptr)) {
                ptr.splice(parseInt(prop, 10), 1);
              } else {
                delete ptr[prop];
              }
            }
          });
        } else {
          obj = null;
        }
        break;
    }
  });
  return obj;
}
