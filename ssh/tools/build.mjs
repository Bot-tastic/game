import * as esbuild from 'esbuild';
const stubs = ['crypto','fs','stream','net','path','os','node-rsa','util','events'];
const stubPlugin = {
  name: 'node-stubs',
  setup(b) {
    b.onResolve({ filter: new RegExp(`^(${stubs.join('|')})$`) }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `class S { constructor(){ throw new Error('Node API unavailable in browser'); } }
module.exports = { Duplex: S, Readable: S, Writable: S, Transform: S, EventEmitter: class {}, promises: {},
  createServer(){ throw new Error('unavailable'); }, platform(){ return 'browser'; }, homedir(){ return ''; },
  join(...p){ return p.join('/'); }, inspect(){ return ''; } };`,
      loader: 'js',
    }));
  },
};
await esbuild.build({
  entryPoints: ['entry.js'], bundle: true, format: 'esm', platform: 'browser', minify: true,
  legalComments: 'eof', outfile: '../vendor/ssh-lib.js', plugins: [stubPlugin],
  define: { global: 'globalThis', 'process.env.NODE_DEBUG': 'false' },
  inject: ['./shim.js'], target: 'es2020', logLimit: 0,
});
await import('node:fs').then((fs) =>
  fs.copyFileSync('node_modules/@xterm/xterm/css/xterm.css', '../vendor/xterm.css'));
