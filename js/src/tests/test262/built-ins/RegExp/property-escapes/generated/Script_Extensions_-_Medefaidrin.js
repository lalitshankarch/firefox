// Copyright 2024 Mathias Bynens. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
author: Mathias Bynens
description: >
  Unicode property escapes for `Script_Extensions=Medefaidrin`
info: |
  Generated by https://github.com/mathiasbynens/unicode-property-escapes-tests
  Unicode v16.0.0
esid: sec-static-semantics-unicodematchproperty-p
features: [regexp-unicode-property-escapes]
includes: [regExpUtils.js]
---*/

const matchSymbols = buildString({
  loneCodePoints: [],
  ranges: [
    [0x016E40, 0x016E9A]
  ]
});
testPropertyEscapes(
  /^\p{Script_Extensions=Medefaidrin}+$/u,
  matchSymbols,
  "\\p{Script_Extensions=Medefaidrin}"
);
testPropertyEscapes(
  /^\p{Script_Extensions=Medf}+$/u,
  matchSymbols,
  "\\p{Script_Extensions=Medf}"
);
testPropertyEscapes(
  /^\p{scx=Medefaidrin}+$/u,
  matchSymbols,
  "\\p{scx=Medefaidrin}"
);
testPropertyEscapes(
  /^\p{scx=Medf}+$/u,
  matchSymbols,
  "\\p{scx=Medf}"
);

const nonMatchSymbols = buildString({
  loneCodePoints: [],
  ranges: [
    [0x00DC00, 0x00DFFF],
    [0x000000, 0x00DBFF],
    [0x00E000, 0x016E3F],
    [0x016E9B, 0x10FFFF]
  ]
});
testPropertyEscapes(
  /^\P{Script_Extensions=Medefaidrin}+$/u,
  nonMatchSymbols,
  "\\P{Script_Extensions=Medefaidrin}"
);
testPropertyEscapes(
  /^\P{Script_Extensions=Medf}+$/u,
  nonMatchSymbols,
  "\\P{Script_Extensions=Medf}"
);
testPropertyEscapes(
  /^\P{scx=Medefaidrin}+$/u,
  nonMatchSymbols,
  "\\P{scx=Medefaidrin}"
);
testPropertyEscapes(
  /^\P{scx=Medf}+$/u,
  nonMatchSymbols,
  "\\P{scx=Medf}"
);

reportCompare(0, 0);
