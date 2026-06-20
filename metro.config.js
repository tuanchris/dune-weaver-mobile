const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
// Bundle raw pattern files (.thr) as assets so they can be read at runtime and
// uploaded to the board. .webp previews are already in the default assetExts.
config.resolver.assetExts.push('thr')

module.exports = config
