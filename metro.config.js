const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
// Bundle raw pattern files (.thr) as assets so they can be read at runtime and
// uploaded to the board. .webp previews are already in the default assetExts.
config.resolver.assetExts.push('thr')

// Dev-server fix: subdirectory assets required from the generated manifest
// (assets/previews/*, assets/thr/*) are fetched via Metro's `unstable_path`
// query with DOUBLE-encoded slashes (%252F). Metro decodes once, leaving "%2F"
// in the path, then readdir's a literal ".%2Fassets%2Fpreviews" dir -> ENOENT +
// a 404'd image, spamming the logs. We undo the double-encoding so Metro sees
// real "/" separators. Scoped to URLs that actually contain %252F, so every
// other request passes through untouched (prod export is unaffected).
const prevRewrite = config.server && config.server.rewriteRequestUrl
config.server = {
  ...config.server,
  rewriteRequestUrl(url) {
    const next = prevRewrite ? prevRewrite(url) : url
    return next.includes('%252F') || next.includes('%252f') ? next.replace(/%252[Ff]/g, '%2F') : next
  },
}

module.exports = config
