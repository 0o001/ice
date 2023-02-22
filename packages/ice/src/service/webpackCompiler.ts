import webpackBundler from '@ice/bundles/compiled/webpack/index.js';
import type ora from '@ice/bundles/compiled/ora/index.js';
import lodash from '@ice/bundles/compiled/lodash/index.js';
import type { TaskConfig, Context } from 'build-scripts';
import type { Config } from '@ice/webpack-config/esm/types';
import type webpack from 'webpack';
import type { Urls, ServerCompiler, GetAppConfig, GetRoutesConfig, ExtendsPluginAPI, GetDataloaderConfig } from '../types/plugin.js';
import formatWebpackMessages from '../utils/formatWebpackMessages.js';
import type ServerCompilerPlugin from '../webpack/ServerCompilerPlugin';
import { IMPORT_META_RENDERER, IMPORT_META_TARGET, WEB } from '../constant.js';
import getServerCompilerPlugin from '../utils/getServerCompilerPlugin.js';
import DataLoaderPlugin from '../webpack/DataLoaderPlugin.js';
import ReCompilePlugin from '../webpack/ReCompilePlugin.js';
import { logger } from '../utils/logger.js';
import { getRouteExportConfig } from './config.js';

const { debounce } = lodash;

async function webpackCompiler(options: {
  context: Context<Config, ExtendsPluginAPI>;
  webpackConfigs: webpack.Configuration[];
  taskConfigs: TaskConfig<Config>[];
  urls?: Urls;
  spinner: ora.Ora;
  devPath?: string;
  hooksAPI: {
    serverCompiler: ServerCompiler;
    getAppConfig: GetAppConfig;
    getRoutesConfig: GetRoutesConfig;
    getDataloaderConfig: GetDataloaderConfig;
  };
}) {
  const {
    taskConfigs,
    urls,
    hooksAPI,
    webpackConfigs,
    spinner,
    devPath,
    context,
  } = options;
  const { rootDir, applyHook, commandArgs, command, userConfig, getAllPlugin } = context;
  // `commandArgs` doesn't guarantee target exists.
  const { target = WEB } = commandArgs;
  const { serverCompiler } = hooksAPI;
  const { serverCompileTask, dataCache, watch } = context.extendsPluginAPI;

  await applyHook(`before.${command}.run`, {
    urls,
    commandArgs,
    taskConfigs,
    webpackConfigs,
    ...hooksAPI,
  });

  for (const taskConfig of taskConfigs) {
    const index = taskConfigs.indexOf(taskConfig);
    const webpackConfig = webpackConfigs[index];
    const { useDevServer, useDataLoader, server } = taskConfig.config;
    const { reCompile: reCompileRouteConfig, ensureRoutesConfig } = getRouteExportConfig(rootDir);
    let serverCompilerPlugin: ServerCompilerPlugin;

    // Add webpack [ServerCompilerPlugin]
    if (useDevServer) {
      const outputDir = webpackConfig.output.path;
      serverCompilerPlugin = getServerCompilerPlugin(serverCompiler, {
        rootDir,
        serverEntry: server?.entry,
        outputDir,
        dataCache,
        serverCompileTask: command === 'start' ? serverCompileTask : null,
        userConfig,
        ensureRoutesConfig,
        runtimeDefineVars: {
          [IMPORT_META_TARGET]: JSON.stringify(target),
          [IMPORT_META_RENDERER]: JSON.stringify('server'),
        },
        incremental: command === 'start',
      });
      webpackConfig.plugins.push(serverCompilerPlugin);

      // Add re-compile plugin
      if (command === 'start') {
        webpackConfig.plugins.push(
          new ReCompilePlugin(reCompileRouteConfig, (files) => {
            // Only when routes file changed.
            const routeManifest = JSON.parse(dataCache.get('routes'))?.routeManifest || {};
            const routeFiles = Object.keys(routeManifest).map((key) => {
              const { file } = routeManifest[key];
              return `src/pages/${file}`;
            });
            return files.some((filePath) => routeFiles.some(routeFile => filePath.includes(routeFile)));
          }),
        );
        const debounceCompile = debounce(() => {
          serverCompilerPlugin?.buildResult?.rebuild();
          console.log('Document updated, try to reload page for latest html content.');
        }, 200);
        watch.addEvent([
          /src\/document(\/index)?(.js|.jsx|.tsx)/,
          (event: string) => {
            if (event === 'change') {
              debounceCompile();
            }
          },
        ]);
      }
    }

    // Add webpack plugin of data-loader.
    if (useDataLoader) {
      webpackConfig.plugins.push(new DataLoaderPlugin({ serverCompiler, target, rootDir, dataCache, getAllPlugin }));
    }
  }

  // Add spinner for first webpack task.
  // @TODO: Merge tasks for multi compiler.
  const firstWebpackConfig = webpackConfigs[0];
  firstWebpackConfig.plugins.push((compiler: webpack.Compiler) => {
    compiler.hooks.beforeCompile.tap('spinner', () => {
      spinner.text = 'Compiling...\n';
    });
    compiler.hooks.afterEmit.tap('spinner', () => {
      spinner.stop();
    });
  });
  let compiler: webpack.Compiler;
  try {
    // @ts-ignore
    compiler = webpackBundler(webpackConfigs);
  } catch (error) {
    logger.error('Webpack compile with errors.');
    logger.error(error);
  }

  let isFirstCompile = true;

  compiler.hooks.done.tap('done', async stats => {
    const statsData = stats.toJson({
      all: false,
      warnings: true,
      errors: true,
      timings: true,
      assets: true,
    });
    const messages = formatWebpackMessages(statsData);
    const isSuccessful = !messages.errors.length;
    if (messages.errors.length) {
      // Only keep the first error. Others are often indicative
      // of the same problem, but confuse the reader with noise.
      if (messages.errors.length > 1) {
        messages.errors.length = 1;
      }
      logger.error('Client compiled with errors.');
      console.error(messages.errors.join('\n'));
      return;
    } else if (messages.warnings.length) {
      logger.warn('Client compiled with warnings.');
      logger.warn(messages.warnings.join('\n'));
    }
    if (command === 'start') {
      // compiler.hooks.done is AsyncSeriesHook which does not support async function
      await applyHook('after.start.compile', {
        stats,
        isSuccessful,
        isFirstCompile,
        urls,
        devUrlInfo: {
          devPath,
        },
        messages,
        taskConfigs,
        ...hooksAPI,
      });
    }

    if (isSuccessful) {
      // if compiled successfully reset first compile flag after been posted to lifecycle hooks
      isFirstCompile = false;
    }
  });

  return compiler;
}

export default webpackCompiler;
