#!/usr/bin/env node
/**
 * Bundle framework files for webapp build
 * - Pre-compiles Ruby to mrb bytecode for irep loading (avoids WASM longjmp issues)
 * - Falls back to source eval if mrbc is not available
 * - Bundles CSS and copies JSX runtime
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webappRoot = join(__dirname, '..');
const frameworkRoot = join(__dirname, '../../..');

function escapeForTemplate(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

function findMrbc() {
  // Temporarily disabled for debugging eval fallback
  if (process.env.HOMURA_NO_MRBC) return null;
  const candidates = [
    join(frameworkRoot, 'mruby/mruby-src/build/host/bin/mrbc'),
    join(frameworkRoot, 'mruby/build/host/bin/mrbc'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function compileMrb(mrbc, rubyPath, outputPath) {
  try {
    execFileSync(mrbc, ['-o', outputPath, rubyPath], { stdio: 'pipe' });
    return readFileSync(outputPath);
  } catch (e) {
    return null;
  }
}

/**
 * Split Ruby source into chunks that mrbc can handle.
 * Splits at top-level class/end and $app.* route boundaries.
 */
function splitRubyForMrbc(source) {
  const lines = source.split('\n');
  const chunks = [];
  let current = [];
  let depth = 0;
  let inClass = false;

  // Patterns that open a new block (require matching `end`)
  const blockOpenRe = /^(class|module|def|if|unless|while|until|case|begin|for)\b/;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and strings for block detection
    if (trimmed.startsWith('#') || trimmed === '') {
      current.push(line);
      continue;
    }

    // Detect block-opening keywords at start of line
    const openMatch = blockOpenRe.test(trimmed);
    // Also detect do-blocks: "} do |" or "word do$" or "word do |"
    const doBlock = /\bdo\s*(\|.*\|)?\s*$/.test(trimmed);
    // Inline if/unless/while/until (postfix) should NOT count - detect by checking if keyword is not at start
    const isPostfix = /\b(if|unless|while|until)\b/.test(trimmed) &&
      !/^(if|unless|while|until)\b/.test(trimmed);

    // Start of a top-level class/module → flush previous non-class content
    if (/^(class|module)\s/.test(trimmed) && depth === 0) {
      if (current.length > 0) {
        const text = current.join('\n').trim();
        if (text) chunks.push(text);
        current = [];
      }
      inClass = true;
    }

    current.push(line);

    // Count depth changes
    if (openMatch && !isPostfix) {
      depth++;
    } else if (doBlock) {
      depth++;
    }

    if (trimmed === 'end' && depth > 0) {
      depth--;
      if (depth === 0 && inClass) {
        chunks.push(current.join('\n'));
        current = [];
        inClass = false;
      }
    }
  }

  if (current.length > 0) {
    const text = current.join('\n').trim();
    if (text) chunks.push(text);
  }

  // Further split large route chunks (~100 lines max per chunk)
  const result = [];
  for (const chunk of chunks) {
    const chunkLines = chunk.split('\n');
    if (chunkLines.length <= 120 || /^class\s/.test(chunkLines[0].trim())) {
      result.push(chunk);
    } else {
      // Split route definitions into ~100 line batches at $app.* boundaries
      let batch = [];
      for (const line of chunkLines) {
        if (/^\$app\.\w+\s/.test(line.trim()) && batch.length >= 80) {
          result.push(batch.join('\n'));
          batch = [];
        }
        batch.push(line);
      }
      if (batch.length > 0) result.push(batch.join('\n'));
    }
  }

  return result;
}

function compileChunks(mrbc, chunks, label) {
  const compiled = [];
  for (let i = 0; i < chunks.length; i++) {
    const tmpRb = `/tmp/homura_chunk_${label}_${i}.rb`;
    const tmpMrb = `/tmp/homura_chunk_${label}_${i}.mrb`;
    writeFileSync(tmpRb, chunks[i]);
    const mrb = compileMrb(mrbc, tmpRb, tmpMrb);
    if (!mrb) {
      console.warn(`⚠️  mrbc failed for ${label} chunk ${i + 1}/${chunks.length} (${chunks[i].split('\n')[0].substring(0, 60)})`);
      return null;
    }
    compiled.push(mrb);
  }
  return compiled;
}

function main() {
  const homuraCore = readFileSync(join(frameworkRoot, 'lib/homura.rb'), 'utf-8');
  const homuraModel = readFileSync(join(frameworkRoot, 'lib/homura_model.rb'), 'utf-8');
  const modelsFile = join(webappRoot, 'app/models.rb');
  const userModels = existsSync(modelsFile) ? readFileSync(modelsFile, 'utf-8') : '';
  const routesFile = process.env.HOMURA_ROUTES || 'app/routes.rb';
  const userRoutes = readFileSync(join(webappRoot, routesFile), 'utf-8');

  const mrbc = findMrbc();
  let irepData = null;

  if (mrbc) {
    console.log(`🔧 Found mrbc: ${mrbc}`);

    // Compile core and model as single files
    const coreMrb = compileMrb(mrbc, join(frameworkRoot, 'lib/homura.rb'), '/tmp/homura_core.mrb');
    const modelMrb = compileMrb(mrbc, join(frameworkRoot, 'lib/homura_model.rb'), '/tmp/homura_model.mrb');

    // Compile models if present
    let modelsMrb = null;
    if (userModels) {
      const modelsTmpRb = '/tmp/homura_user_models.rb';
      writeFileSync(modelsTmpRb, userModels);
      modelsMrb = compileMrb(mrbc, modelsTmpRb, '/tmp/homura_user_models.mrb');
      if (!modelsMrb) {
        console.warn('⚠️  Failed to compile models.rb');
      }
    }

    if (!coreMrb || !modelMrb) {
      console.warn('⚠️  Failed to compile core/model, falling back to eval');
    } else {
      // Split routes into compilable chunks
      const routeChunks = splitRubyForMrbc(userRoutes);
      console.log(`📦 Routes split into ${routeChunks.length} chunks for mrbc`);

      const routeMrbs = compileChunks(mrbc, routeChunks, 'routes');

      if (routeMrbs) {
        const totalRouteBytes = routeMrbs.reduce((sum, b) => sum + b.length, 0);
        const modelsInfo = modelsMrb ? `, models: ${modelsMrb.length}B` : '';
        console.log(`✅ All bytecodes compiled (core: ${coreMrb.length}B, model: ${modelMrb.length}B${modelsInfo}, routes: ${totalRouteBytes}B in ${routeMrbs.length} chunks)`);
        irepData = {
          core: coreMrb.toString('base64'),
          model: modelMrb.toString('base64'),
          models: modelsMrb ? modelsMrb.toString('base64') : null,
          routeChunks: routeMrbs.map(b => b.toString('base64')),
        };
      } else {
        console.warn('⚠️  Failed to compile routes, falling back to eval');
      }
    }
  } else {
    console.warn('⚠️  mrbc not found, using eval-only mode');
  }

  let rubyBundle = `// Auto-generated by scripts/bundle-ruby.js
// DO NOT EDIT THIS FILE DIRECTLY

export const HOMURA_CORE = \`${escapeForTemplate(homuraCore)}\`;
export const HOMURA_MODEL = \`${escapeForTemplate(homuraModel)}\`;
export const USER_MODELS = \`${escapeForTemplate(userModels)}\`;
export const USER_ROUTES = \`${escapeForTemplate(userRoutes)}\`;
`;

  if (irepData) {
    rubyBundle += `
// Pre-compiled mrb bytecode (base64) for irep loading
export const HOMURA_CORE_MRB = '${irepData.core}';
export const HOMURA_MODEL_MRB = '${irepData.model}';
export const USER_MODELS_MRB = '${irepData.models || ''}';
export const USER_ROUTES_MRB_CHUNKS: string[] = ${JSON.stringify(irepData.routeChunks)};
export const HAS_PRECOMPILED = true;
`;
  } else {
    rubyBundle += `
export const HOMURA_CORE_MRB = '';
export const HOMURA_MODEL_MRB = '';
export const USER_MODELS_MRB = '';
export const USER_ROUTES_MRB_CHUNKS: string[] = [];
export const HAS_PRECOMPILED = false;
`;
  }

  writeFileSync(join(webappRoot, 'src/ruby-bundle.ts'), rubyBundle);
  console.log('✅ Generated src/ruby-bundle.ts');

  // Bundle CSS
  const cssPath = join(webappRoot, 'app/styles.css');
  if (existsSync(cssPath)) {
    const appCss = readFileSync(cssPath, 'utf-8');
    writeFileSync(join(webappRoot, 'src/styles-bundle.ts'), `// Auto-generated
export const APP_CSS = \`${escapeForTemplate(appCss)}\`;
`);
    console.log('✅ Generated src/styles-bundle.ts');
  }

  // Copy JSX runtime
  const libDir = join(webappRoot, 'src/lib');
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(frameworkRoot, 'lib/jsx/jsx-runtime.ts'), join(libDir, 'jsx-runtime.ts'));
  copyFileSync(join(frameworkRoot, 'lib/jsx/render.ts'), join(libDir, 'render.ts'));
  console.log('✅ Copied JSX runtime to src/lib/');
}

main();
