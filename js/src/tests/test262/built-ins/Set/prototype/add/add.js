// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-set.prototype.add
description: >
    Set.prototype.add ( value )

    17 ECMAScript Standard Built-in Objects

includes: [propertyHelper.js]
---*/

assert.sameValue(
  typeof Set.prototype.add,
  "function",
  "`typeof Set.prototype.add` is `'function'`"
);

verifyProperty(Set.prototype, "add", {
  writable: true,
  enumerable: false,
  configurable: true,
});

reportCompare(0, 0);
