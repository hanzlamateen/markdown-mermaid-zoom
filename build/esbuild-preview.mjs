import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');
const distPreviewDir = path.join(__dirname, '..', 'dist-preview');

const cssTextPlugin = {
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

const sharedOptions = {
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

async function main() {
	const isWatch = process.argv.includes('--watch');

	const previewOptions = {
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
		await esbuild.build(previewOptions);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
