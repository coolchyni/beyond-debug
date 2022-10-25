const  { nativeNodeModulesPlugin }  = require("esbuild-native-node-modules-plugin");
require('esbuild').build({
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    plugins: [nativeNodeModulesPlugin],
    external: ['vscode'],
    format:'cjs',
    platform:'node'
    //loader: { '.png': 'binary' },
  }).catch(() => process.exit(1))