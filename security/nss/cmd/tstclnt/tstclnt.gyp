# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
{
  'includes': [
    '../../coreconf/config.gypi',
    '../../cmd/platlibs.gypi'
  ],
  'targets': [
    {
      'target_name': 'tstclnt',
      'type': 'executable',
      'sources': [
        'tstclnt.c'
      ],
      'dependencies': [
        '<(DEPTH)/exports.gyp:dbm_exports',
        '<(DEPTH)/exports.gyp:nss_exports',
        '<(DEPTH)/lib/zlib/zlib.gyp:nss_zlib'
      ],
      'include_dirs': [
        '<(DEPTH)/lib/ssl',
      ],
    }
  ],
  'target_defaults': {
    'defines': [
      'DLL_PREFIX=\"<(dll_prefix)\"',
      'DLL_SUFFIX=\"<(dll_suffix)\"'
    ]
  },
  'variables': {
    'module': 'nss'
  }
}