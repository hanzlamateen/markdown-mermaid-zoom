import esbuild, { type BuildOptions, type Plugin } from 'esbuild';
import path from 'path';

const srcDir = path.join(import.meta.dirname, '..', 'src');
const distPreviewDir = path.join(import.meta.dirname, '..', 'dist-preview');

// Plugin to bundle CSS files and export as a JS string
const cssTextPlugin: Plugin = {
	name: 'css-text',
	setup(build) {
		build.onLoad({ filter: /\.css$/ }, async (args) => {
			const result = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				minify: true,
				write: false,
				loader: {
					'.ttf': 'dataurl',
					'.woff': 'dataurl',
					'.woff2': 'dataurl',
				},
			});
			const css = result.outputFiles[0].text;
			return {
				contents: `export default ${JSON.stringify(css)};`,
				loader: 'js',
			};
		});
	},
};

const sharedOptions: BuildOptions = {
	bundle: true,
	minify: true,
	sourcemap: false,
	platform: 'browser',
	target: ['es2022'],
	external: ['fs'],
	loader: {
		'.ttf': 'dataurl',
	},
	plugins: [cssTextPlugin],
};

async function build(options: BuildOptions) {
	await esbuild.build(options);
}

async function main() {
	const isWatch = process.argv.includes('--watch');

	const previewOptions: BuildOptions = {
		...sharedOptions,
		entryPoints: {
			'index.bundle': path.join(srcDir, 'preview', 'index.ts'),
		},
		outdir: distPreviewDir,
		format: 'iife',
	};

	if (isWatch) {
		const ctx = await esbuild.context(previewOptions);
		await ctx.watch();
		console.log('Watching preview for changes...');
	} else {
		await build(previewOptions);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
