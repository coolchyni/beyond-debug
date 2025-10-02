const  { nativeNodeModulesPlugin }  = require("esbuild-native-node-modules-plugin");
const { platform } = require("os");

// Parse command line arguments
const args = process.argv.slice(2);
const shouldMinify = args.includes('--minify');
const shouldGenerateSourcemap = args.includes('--sourcemap');
const shouldWatch = args.includes('--watch');

const buildOptions = {
    sourcemap: shouldGenerateSourcemap,
    minify: shouldMinify,
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    plugins: platform=="win32"?[nativeNodeModulesPlugin]:[],
    external: ['vscode', '*.node'], // Treat .node files as external
    format:'cjs',
    platform:'node',
    loader: { '.node': 'file' }, // Loader for .node files
    //loader: { '.png': 'binary' },
};

if (shouldWatch) {
    buildOptions.watch = {
        onRebuild(error, result) {
            if (error) console.error('Watch build failed:', error);
            else console.log('Watch build succeeded');
        }
    };
}

require('esbuild').build(buildOptions).catch(() => process.exit(1))