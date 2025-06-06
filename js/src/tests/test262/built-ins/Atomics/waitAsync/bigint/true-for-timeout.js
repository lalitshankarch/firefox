// |reftest| shell-option(--setpref=atomics_wait_async=true) skip-if(!this.hasOwnProperty('SharedArrayBuffer')||!this.hasOwnProperty('Atomics')||(this.hasOwnProperty('getBuildConfiguration')&&getBuildConfiguration('arm64-simulator'))||!xulRuntime.shell) async -- SharedArrayBuffer,Atomics is not enabled unconditionally, ARM64 Simulator cannot emulate atomics, requires shell-options
// Copyright (C) 2020 Rick Waldron. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-atomics.waitasync
description: >
  Throws a TypeError if index arg can not be converted to an Integer
info: |
  Atomics.waitAsync( typedArray, index, value, timeout )

  1. Return DoWait(async, typedArray, index, value, timeout).

  DoWait ( mode, typedArray, index, value, timeout )

  6. Let q be ? ToNumber(timeout).

    Boolean -> If argument is true, return 1. If argument is false, return +0.

flags: [async]
includes: [atomicsHelper.js]
features: [Atomics.waitAsync, SharedArrayBuffer, TypedArray, Atomics, BigInt, computed-property-names, Symbol, Symbol.toPrimitive, arrow-function]
---*/
assert.sameValue(typeof Atomics.waitAsync, 'function', 'The value of `typeof Atomics.waitAsync` is "function"');
const i64a = new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT * 4));

const valueOf = {
  valueOf() {
    return true;
  }
};

const toPrimitive = {
  [Symbol.toPrimitive]() {
    return true;
  }
};

let outcomes = [];
let lifespan = 1000;
let start = $262.agent.monotonicNow();

(function wait() {
  let elapsed = $262.agent.monotonicNow() - start;

  if (elapsed > lifespan) {
    $DONE('Test timed out');
    return;
  }

  if (outcomes.length) {
    assert.sameValue(outcomes[0], 'timed-out', 'The value of outcomes[0] is "timed-out"');
    assert.sameValue(outcomes[1], 'timed-out', 'The value of outcomes[1] is "timed-out"');
    assert.sameValue(outcomes[2], 'timed-out', 'The value of outcomes[2] is "timed-out"');
    $DONE();
    return;
  }

  $262.agent.setTimeout(wait, 0);
})();

Promise.all([
  Atomics.waitAsync(i64a, 0, 0n, true).value,
  Atomics.waitAsync(i64a, 0, 0n, valueOf).value,
  Atomics.waitAsync(i64a, 0, 0n, toPrimitive).value
]).then(results => outcomes = results, $DONE);
