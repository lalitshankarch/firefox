// |reftest| skip-if(!this.hasOwnProperty('Atomics')) -- Atomics is not enabled unconditionally
// Copyright (C) 2019 André Bargull. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-atomics.notify
description: >
  TypedArray type is validated before `count` argument is coerced.
info: |
  24.4.12 Atomics.notify ( typedArray, index, count )
    1. Let buffer be ? ValidateSharedIntegerTypedArray(typedArray, true).
    ...

  24.4.1.1 ValidateSharedIntegerTypedArray ( typedArray [ , onlyInt32 ] )
    ...
    4. Let typeName be typedArray.[[TypedArrayName]].
    5. If onlyInt32 is true, then
      a. If typeName is not "Int32Array", throw a TypeError exception.
    6. Else,
      a. If typeName is not "Int8Array", "Uint8Array", "Int16Array", "Uint16Array", "Int32Array",
         or "Uint32Array", throw a TypeError exception.
    ...
includes: [testTypedArray.js]
features: [Atomics, TypedArray]
---*/

var count = {
  valueOf() {
    throw new Test262Error("count coerced");
  }
};

var badArrayTypes = typedArrayConstructors.filter(function(TA) { return TA !== Int32Array; });

for (var badArrayType of badArrayTypes) {
  var typedArray = new badArrayType(new SharedArrayBuffer(8));
  assert.throws(TypeError, function() {
    Atomics.notify(typedArray, 0, count);
  });
}

reportCompare(0, 0);
