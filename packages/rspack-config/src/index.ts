import * as path from 'path';
import { createRequire } from 'module';
import { compilationPlugin, compileExcludes, getDefineVars } from '@ice/shared-config';
import type { Config } from '@ice/shared-config/types';
import type { Configuration } from '@rspack/core';
import AssetManifest from './plugins/AssetManifest.js';
import getSplitChunks from './splitChunks.js';
import getAssetsRule from './assetsRule.js';
import getCssRules from './cssRules.js';

interface GetRspackConfigOptions {
  rootDir: string;
  taskConfig: Config;
  runtimeTmpDir: string;
  getExpandedEnvs: () => Record<string, string>;
  runtimeDefineVars?: Record<string, any>;
  getRoutesFile?: () => string[];
  localIdentName?: string;
}

type GetConfig = (
  options: GetRspackConfigOptions,
) => Configuration;

const require = createRequire(import.meta.url);

const getConfig: GetConfig = (options) => {
  const {
    rootDir,
    taskConfig,
    runtimeTmpDir,
    getExpandedEnvs,
    runtimeDefineVars,
    getRoutesFile,
    localIdentName,
  } = options;

  const {
    mode,
    publicPath = '/',
    cacheDir,
    outputDir = 'build',
    sourceMap,
    externals = {},
    alias = {},
    compileIncludes,
    polyfill,
    swcOptions,
    hash,
    define = {},
    splitChunks,
    enableRpx2Vw = true,
    postcss,
    proxy,
    devServer = {},
    plugins = [],
    middlewares,
  } = taskConfig || {};
  const absoluteOutputDir = path.isAbsolute(outputDir) ? outputDir : path.join(rootDir, outputDir);
  const hashKey = hash === true ? 'hash:8' : (hash || '');
  const compilation = compilationPlugin({
    rootDir,
    cacheDir,
    sourceMap,
    fastRefresh: false,
    mode,
    compileIncludes,
    compileExcludes,
    swcOptions,
    polyfill,
    enableEnv: true,
    getRoutesFile,
  });
  const cssFilename = `css/${hashKey ? `[name]-[${hashKey}].css` : '[name].css'}`;
  const config: Configuration = {
    entry: {
      main: [path.join(rootDir, runtimeTmpDir, 'entry.client.tsx')],
    },
    name: 'web',
    mode,
    externals,
    output: {
      clean: true,
      publicPath,
      path: absoluteOutputDir,
      filename: `js/${hashKey ? `[name]-[${hashKey}].js` : '[name].js'}`,
      cssFilename,
      cssChunkFilename: cssFilename,
      assetModuleFilename: 'assets/[name].[hash:8][ext]',
    },
    context: rootDir,
    module: {
      rules: [
        // Compliation rules for js / ts.
        {
          test: compilation.transformInclude,
          use: [{
            loader: require.resolve('@ice/shared-config/compilation-loader'),
            options: {
              transform: compilation.transform,
            },
          }],
        },
        ...getAssetsRule(),
        ...getCssRules({
          rootDir,
          enableRpx2Vw,
          postcssOptions: postcss,
        }),
      ],
    },
    resolve: {
      alias,
    },
    watchOptions: {
      ignored: /node_modules/,
      aggregateTimeout: 100,
    },
    optimization: {
      splitChunks: typeof splitChunks == 'object'
        ? splitChunks
        : getSplitChunks(rootDir, splitChunks),
    },
    // @ts-expect-error plugin instance defined by default in not compatible with rspack.
    plugins: [
      new AssetManifest({
        fileName: 'assets-manifest.json',
        outputDir: path.join(rootDir, runtimeTmpDir),
      }),
      ...plugins,
    ].filter(Boolean),
    builtins: {
      define: getDefineVars(define, runtimeDefineVars, getExpandedEnvs),
      provide: {
        process: [require.resolve('process/browser')],
        $ReactRefreshRuntime$: [require.resolve('./client/reactRefresh.cjs')],
      },
      devFriendlySplitChunks: true,
      css: {
        modules: { localIdentName },
      },
    },
    stats: 'none',
    infrastructureLogging: {
      level: 'warn',
    },
    devServer: {
      allowedHosts: 'all',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
      },
      // @ts-expect-error devServer.hot in rspack only support boolean.
      hot: true,
      compress: false,
      proxy,
      devMiddleware: {
        publicPath,
      },
      client: {
        logging: 'info',
      },
      ...devServer,
      setupMiddlewares: middlewares,
    },
  };
  return config;
};


export default getConfig;
