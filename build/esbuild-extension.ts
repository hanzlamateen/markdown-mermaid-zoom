import esbuild, { type BuildOptions } from 'esbuild';
import path from 'path';

const srcDir = path.join(import.meta.dirname, '..', 'src');
const distDir = path.join(import.meta.dirname, '..', 'dist');

const sharedOptions: BuildOptions = {
	bundle: true,
	external: ['vscode'],
	sourcemap: true,
};

async function build(options: BuildOptions) {
	await esbuild.build(options);
}

async function main() {
	const isWatch = process.argv.includes('--watch');
	const isProduction = process.argv.includes('--production');

	const extensionOptions: BuildOptions = {
		...sharedOptions,
		entryPoints: [path.join(srcDir, 'extension', 'index.ts')],
		outfile: path.join(distDir, 'index.js'),
		format: 'cjs',
		platform: 'node',
		minify: isProduction,
		sourcemap: isProduction ? false : true,
	};

	if (isWatch) {
		const ctx = await esbuild.context(extensionOptions);
		await ctx.watch();
		console.log('Watching extension for changes...');
	} else {
		await build(extensionOptions);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
