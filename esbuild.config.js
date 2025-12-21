export default {
  entryPoints: ['src/index.ts'],
  bundle: true,
  target: 'es2020',
  outdir: 'dist',
  format: 'esm',
  outExtension: { '.js': '.js' },
};
