// |reftest| shell-option(--enable-iterator-helpers) skip-if(!this.hasOwnProperty('Iterator')||!xulRuntime.shell) -- iterator-helpers is not enabled unconditionally, requires shell-options
// Copyright (C) 2024 Mozilla Corporation. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: pending
description: |
  %Iterator.prototype%.map outputs correct value at end of iterator.
features:
  - iterator-helpers
includes: [sm/non262.js, sm/non262-shell.js]
flags:
  - noStrict
---*/
const iterator = [0].values().map(x => x);

const iterRecord = iterator.next();
assert.sameValue(iterRecord.done, false);
assert.sameValue(iterRecord.value, 0);

let endRecord = iterator.next();
assert.sameValue(endRecord.done, true);
assert.sameValue(endRecord.value, undefined);

endRecord = iterator.next();
assert.sameValue(endRecord.done, true);
assert.sameValue(endRecord.value, undefined);


reportCompare(0, 0);
