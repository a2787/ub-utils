/* Build the installable MV3 product from the same userscript source used by
 * the compatibility and development harnesses.
 *
 * The generated dist/extension directory is deliberately ignored. A release
 * artifact is reproducible from omniblock.user.js plus the tracked extension,
 * sync, and service-worker sources; it is not hand-edited.
 */
process.env.OMNIBLOCK_EXTENSION_PRODUCT = '1';
const result = require('../test/build-dev-extension.cjs');
console.log(JSON.stringify({
  status: 'product-extension-built',
  directory: 'dist/extension',
  version: result.version,
  build: result.build,
  sourceHash: result.sourceHash,
  install: 'Edge/Chrome -> extensions -> developer mode -> load unpacked -> dist/extension',
}, null, 2));
