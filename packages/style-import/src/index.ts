import { init, parse } from 'es-module-lexer';
import MagicString from 'magic-string';
import type { ImportSpecifier, ExportSpecifier } from 'es-module-lexer';

interface TransformOptions {
  libraryName: string;
  style: ((name: string) => string) | Boolean;
  sourceMap?: Boolean;
  kebabCase?: Boolean;
}

export async function importStyle(code: string, options: TransformOptions): Promise<null | {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}> {
  const { style, libraryName, sourceMap, kebabCase = true } = options;
  if (!style) {
    return null;
  }
  await init;
  let imports: readonly ImportSpecifier[] = [];
  try {
    imports = parse(code)[0];
  } catch (error) {
    console.log(error);
    return null;
  }

  if (!imports.length) {
    return null;
  }
  let s: MagicString | undefined;
  const str = () => s || (s = new MagicString(code));
  imports.forEach(({ n, se, ss }) => {
    if (n && n === libraryName) {
      const importStr = code.slice(ss, se);
      let styleStatements = [];
      // Get specifiers by export statement (es-module-lexer can analyze name exported).
      if (importStr) {
        const exportSource = importStr.replace('import ', 'export ').replace(/\s+as\s+\w+,?/g, ',');
        let exports: ExportSpecifier[] = [];
        try {
          exports = parse(exportSource)[1];
        } catch (error) {
          console.log(`Error occurred when analyzing code: ${importStr}`);
          console.log(error);
          return;
        }
        exports.forEach(({ n }) => {
          const toKebabCase = (str: string) => str.replace(/^[A-Z]/, $1 => $1.toLowerCase()).replace(/([A-Z])/g, $1 => `-${$1.toLowerCase()}`);
          let importName = n;
          if (kebabCase) {
             importName = toKebabCase(importName);
          }
          const stylePath = typeof style === 'function' ? style(importName) : `${libraryName}/es/${importName}/style`;
          if (stylePath) {
            styleStatements.push(`import '${stylePath}';`);
          }
        });
      }

      if (styleStatements.length > 0) {
        str().prependRight(
          se + 1,
          `\n${styleStatements.join(
            '\n',
          )}`,
        );
      }
    }
  });

  return {
    code: str().toString(),
    map: sourceMap ? str().generateMap({ hires: true }) : null,
  };
}

export default function importStylePlugin(options: TransformOptions) {
  return {
    name: 'transform-import-style',
    // Add plugin as a post plugin, so we do not need to deal with ts language.
    enforce: 'post',
    transformInclude(id: string) {
      // Only transform source code.
      return id.match(/\.(js|jsx|ts|tsx)$/) && !id.match(/node_modules/);
    },
    async transform(code: string, id: string, transformOption: { isServer: Boolean }) {
      if (transformOption.isServer || !code) {
        return null;
      }
      return await importStyle(code, options);
    },
  };
}
