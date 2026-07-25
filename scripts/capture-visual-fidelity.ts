import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { dirname, extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import {
  CAPTURE_SPECS,
  FALLBACK_IDS,
  MAX_REDUCED_MOTION_DISTANCE,
  REGRESSION_SPECS,
  finalizeEvidence,
  measureCanvasContribution,
  measureCoarseNormalizedDistance,
  measureCoarseStructuralFeatures,
  measureHighFrequencyRetention,
  measureSpatialAnchorSimilarity,
  validateVisualFidelityEvidence,
  type VisualFidelityCapture,
  type VisualFidelityEvidence,
} from './visual-fidelity-evidence';

const execFileAsync = promisify(execFile);
const GIT_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SENSITIVE_ENV_KEYS = [
  'AI_GATEWAY_API_KEY',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'PORTFOLIO_DATABASE_URL',
  'PORTFOLIO_POSTGRES_URL',
  'PUBLIC_PROJECT_SOURCE',
] as const;

type CaptureId = keyof typeof CAPTURE_SPECS;

export async function captureVisualFidelityEvidence(
  headSha: string,
  baseSha: string,
  outputDirectory: string,
  repository: string,
  createdAt = new Date().toISOString(),
): Promise<{ artifactPath: string; evidence: VisualFidelityEvidence }> {
  if (!GIT_SHA.test(headSha) || !GIT_SHA.test(baseSha)) {
    throw new Error('head and base must be full lowercase Git SHAs');
  }
  if (!REPOSITORY.test(repository)) throw new Error('repository must be owner/name');
  await verifyCheckout(headSha, baseSha);

  const outputRoot = resolve(outputDirectory);
  const capturesRoot = resolve(outputRoot, 'captures');
  await mkdir(capturesRoot, { recursive: true });
  await prepareRegressionBaselines(outputRoot);
  const port = await reservePort();
  await buildAstro();
  const server = await startStaticServer(port);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const origin = `http://127.0.0.1:${port}`;
    const captures: VisualFidelityCapture[] = [];
    for (const id of Object.keys(CAPTURE_SPECS) as CaptureId[]) {
      captures.push(await captureScenario(browser, origin, outputRoot, capturesRoot, id));
    }
    const fallbacks = await runFallbacks(browser, origin);
    const evidence = finalizeEvidence({
      schemaVersion: 1,
      repository,
      baseSha,
      headSha,
      createdAt,
      captures,
      fallbacks,
    });
    const artifactPath = resolve(outputRoot, 'visual-fidelity-evidence.json');
    await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    const errors = await validateVisualFidelityEvidence(evidence, {
      artifactPath,
      expectedRepository: repository,
      expectedBaseSha: baseSha,
      expectedHeadSha: headSha,
    });
    if (errors.length > 0) throw new Error(`generated evidence is invalid:\n${errors.join('\n')}`);
    return { artifactPath, evidence };
  } finally {
    await browser?.close();
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
}

async function captureScenario(
  browser: Browser,
  origin: string,
  outputRoot: string,
  capturesRoot: string,
  id: CaptureId,
): Promise<VisualFidelityCapture> {
  const spec = CAPTURE_SPECS[id];
  const desktop = id.startsWith('desktop-');
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    serviceWorkers: 'block',
  });
  try {
    await restrictRequests(context, origin);
    if (desktop) await installVisibilitySpoof(context);
    const page = await context.newPage();
    let navigation: 'pass' | 'fail' = 'fail';
    try {
      const response = await page.goto(`${origin}${spec.route}`, { waitUntil: 'domcontentloaded' });
      navigation = response?.ok() ? 'pass' : 'fail';
    } catch {
      navigation = 'fail';
    }
    let visibilityEventDispatched = false;
    if (desktop) {
      try {
        visibilityEventDispatched = await page.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          return document.hidden === false;
        });
      } catch {
        visibilityEventDispatched = false;
      }
    }
    const readiness = navigation === 'pass' && await waitForReady(page, spec.renderMode)
      ? 'pass' as const
      : 'fail' as const;
    let interaction: VisualFidelityCapture['setup']['interaction'] = 'not-required';
    if (id === 'desktop-guide') {
      try {
        await page.locator('[data-dm-open]').click({ timeout: 5_000 });
        await page.locator('[data-dm-dialog]').waitFor({ state: 'visible', timeout: 5_000 });
        interaction = 'pass';
      } catch {
        interaction = 'fail';
      }
    }
    const filename = `${id}.png`;
    const imagePath = resolve(capturesRoot, filename);
    const bytes = await page.screenshot({ path: imagePath, type: 'png', animations: 'disabled' });
    let canvasContribution: { changedPixels: number; changedRatio: number } | null = null;
    if (id === 'desktop-home') {
      try {
        await page.locator('[data-device-canvas]').evaluate((canvas) => {
          canvas.style.visibility = 'hidden';
        });
        const hiddenCanvasBytes = await page.screenshot({ type: 'png', animations: 'disabled' });
        canvasContribution = await measureCanvasContribution(bytes, hiddenCanvasBytes);
      } catch {
        canvasContribution = null;
      } finally {
        await page.locator('[data-device-canvas]').evaluate((canvas) => {
          canvas.style.removeProperty('visibility');
        }).catch(() => undefined);
      }
    }
    const metadata = await sharp(bytes).metadata();
    const observed = await observe(page);
    const regressionSpec = REGRESSION_SPECS[id as keyof typeof REGRESSION_SPECS];
    let regression: VisualFidelityCapture['regression'] = null;
    if (regressionSpec) {
      const baselineBytes = await readFile(resolve(outputRoot, regressionSpec.artifactPath));
      const [
        normalizedDistance,
        features,
        spatialSimilarity,
        highFrequencyRetention,
      ] = await Promise.all([
        measureCoarseNormalizedDistance(bytes, baselineBytes),
        measureCoarseStructuralFeatures(bytes),
        measureSpatialAnchorSimilarity(bytes, baselineBytes, regressionSpec.currentEdgeAnchor),
        measureHighFrequencyRetention(bytes, baselineBytes),
      ]);
      regression = {
          baseline: {
            path: regressionSpec.artifactPath,
            sha256: regressionSpec.sha256,
            width: 1440,
            height: 900,
          },
          normalizedDistance,
          maxDistance: regressionSpec.maxDistance,
          ...features,
          minLuminanceVariance: regressionSpec.minLuminanceVariance,
          minColorVariance: regressionSpec.minColorVariance,
          minEdgeDensity: regressionSpec.minEdgeDensity,
          spatialSimilarity,
          minSpatialSimilarity: regressionSpec.minSpatialSimilarity,
          highFrequencyRetention,
          minHighFrequencyRetention: regressionSpec.minHighFrequencyRetention,
          result: 'pass' as const,
        };
    }
    return {
      id,
      route: spec.route,
      viewport: { width: spec.width, height: spec.height },
      image: {
        path: `captures/${filename}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
      },
      metrics: {
        ...observed.metrics,
        visibilityEventDispatched,
        canvasChangedPixels: canvasContribution?.changedPixels ?? null,
        canvasChangedRatio: canvasContribution?.changedRatio ?? null,
      },
      semantics: observed.semantics,
      setup: { navigation, readiness, interaction },
      regression,
      renderMode: observed.renderMode,
      visibilitySpoofed: desktop,
      result: 'pass',
    };
  } finally {
    await context.close();
  }
}

async function runFallbacks(
  browser: Browser,
  origin: string,
): Promise<VisualFidelityEvidence['fallbacks']> {
  const execute = async (
    id: (typeof FALLBACK_IDS)[number],
    run: () => Promise<boolean>,
  ): Promise<VisualFidelityEvidence['fallbacks'][number]> => {
    try {
      return { id, setup: 'pass', result: await run() ? 'pass' : 'fail' };
    } catch {
      return { id, setup: 'fail', result: 'fail' };
    }
  };

  const reducedMotion = await execute('reduced-motion', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    try {
      await restrictRequests(context, origin);
      await installVisibilitySpoof(context);
      const page = await context.newPage();
      const response = await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      const ready = await waitForReady(page, 'webgl');
      if (!response?.ok() || !ready) throw new Error('reduced-motion setup failed');
      const observed = await observe(page);
      const prefersReduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      const firstFrame = await page.screenshot({ type: 'png', animations: 'disabled' });
      await page.waitForTimeout(250);
      const secondFrame = await page.screenshot({ type: 'png', animations: 'disabled' });
      const frameDistance = firstFrame.equals(secondFrame)
        ? 0
        : await measureCoarseNormalizedDistance(firstFrame, secondFrame);
      return prefersReduced
        && frameDistance <= MAX_REDUCED_MOTION_DISTANCE
        && observed.semantics.main
        && observed.metrics.horizontalOverflow === 0;
    } finally {
      await context.close();
    }
  });

  const webglUnavailable = await execute('webgl-unavailable', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    try {
      await restrictRequests(context, origin);
      await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          contextId: string,
          ...args: unknown[]
        ) {
          if (/^(?:webgl|webgl2|experimental-webgl)$/.test(contextId)) return null;
          return Reflect.apply(original, this, [contextId, ...args]);
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
      const page = await context.newPage();
      const response = await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      const ready = await waitForReady(page, 'static-unavailable');
      if (!response?.ok() || !ready) throw new Error('webgl-unavailable setup failed');
      const observed = await observe(page);
      return observed.renderMode === 'static-unavailable'
        && observed.semantics.main
        && observed.semantics.navigation
        && observed.metrics.horizontalOverflow === 0;
    } finally {
      await context.close();
    }
  });

  const javascriptDisabled = await execute('javascript-disabled', async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: false,
      serviceWorkers: 'block',
    });
    try {
      await restrictRequests(context, origin);
      const page = await context.newPage();
      const response = await page.goto(`${origin}/contact`, { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) throw new Error('javascript-disabled setup failed');
      const observed = await observe(page);
      return observed.renderMode === 'static-no-js'
        && observed.semantics.main
        && observed.semantics.navigation
        && observed.semantics.heading
        && observed.metrics.horizontalOverflow === 0;
    } finally {
      await context.close();
    }
  });

  return [reducedMotion, webglUnavailable, javascriptDisabled];
}

async function observe(page: Page): Promise<{
  metrics: Omit<
    VisualFidelityCapture['metrics'],
    'visibilityEventDispatched' | 'canvasChangedPixels' | 'canvasChangedRatio'
  >;
  semantics: VisualFidelityCapture['semantics'];
  renderMode: VisualFidelityCapture['renderMode'];
}> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scrollWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
    const webgl = root.dataset.webgl;
    const dialog = document.querySelector<HTMLElement>('[data-dm-dialog]');
    const renderMode = webgl === 'available'
      ? 'webgl'
      : webgl === 'mobile-static'
        ? 'static-responsive'
        : webgl === 'unavailable'
          ? 'static-unavailable'
          : 'static-no-js';
    return {
      metrics: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth,
        horizontalOverflow: Math.max(0, scrollWidth - window.innerWidth),
        documentHidden: document.hidden,
      },
      semantics: {
        main: Boolean(document.querySelector('main')),
        navigation: Boolean(document.querySelector('nav')),
        heading: Boolean(document.querySelector('h1')),
        guide: dialog ? (dialog.hidden ? 'hidden' : 'visible') : 'absent',
      },
      renderMode,
    };
  });
}

async function waitForReady(
  page: Page,
  expected: VisualFidelityCapture['renderMode'],
): Promise<boolean> {
  try {
    await page.evaluate(() => document.fonts.ready);
  const expectedDataset = expected === 'webgl'
    ? 'available'
    : expected === 'static-responsive'
      ? 'mobile-static'
      : expected === 'static-unavailable'
        ? 'unavailable'
        : 'pending';
    await page.waitForFunction(
      (dataset) => document.documentElement.dataset.webgl === dataset,
      expectedDataset,
      { timeout: 15_000 },
    );
    if (expected === 'webgl') {
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-device-overlay-bound], [data-device-route-overlay-bound]')),
        undefined,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(100);
    }
    return true;
  } catch {
    return false;
  }
}

async function installVisibilitySpoof(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
}

async function restrictRequests(context: BrowserContext, origin: string): Promise<void> {
  await context.route('**/*', async (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    if (requestOrigin === origin || route.request().url().startsWith('data:')) {
      await route.continue();
    } else {
      await route.abort('blockedbyclient');
    }
  });
}

async function verifyCheckout(headSha: string, baseSha: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
  if (stdout.trim() !== headSha) throw new Error('headSha must match the checked-out Git head');
  await execFileAsync('git', ['merge-base', '--is-ancestor', baseSha, headSha], { cwd: repositoryRoot });
  await execFileAsync('git', ['diff', '--quiet'], { cwd: repositoryRoot });
  await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: repositoryRoot });
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of SENSITIVE_ENV_KEYS) env[key] = '';
  env.VERCEL = '';
  env.VERCEL_ENV = '';
  env.VERCEL_REGION = '';
  env.CI = '';
  return env;
}

async function buildAstro(): Promise<void> {
  await execFileAsync(
    process.execPath,
    [resolve(repositoryRoot, 'node_modules/astro/bin/astro.mjs'), 'build'],
    {
      cwd: repositoryRoot,
      env: sanitizedEnvironment(),
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function prepareRegressionBaselines(outputRoot: string): Promise<void> {
  await mkdir(resolve(outputRoot, 'baselines'), { recursive: true });
  for (const spec of Object.values(REGRESSION_SPECS)) {
    await cp(
      resolve(repositoryRoot, spec.sourcePath),
      resolve(outputRoot, spec.artifactPath),
      { force: true },
    );
  }
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createPortServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not reserve a local port'));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function startStaticServer(port: number): Promise<Server> {
  const root = resolve(repositoryRoot, 'dist/client');
  const server = createHttpServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const normalized = requestPath.endsWith('/')
        ? `${requestPath}index.html`
        : extname(requestPath)
          ? requestPath
          : `${requestPath}/index.html`;
      const filePath = resolve(root, `.${normalized}`);
      if (!filePath.startsWith(`${root}/`) || !(await stat(filePath)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const contentType = mimeType(filePath);
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return server;
}

function mimeType(path: string): string {
  switch (extname(path)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

async function main(): Promise<void> {
  const [headSha, baseSha, outputDirectory, repository] = process.argv.slice(2);
  if (!headSha || !baseSha || !outputDirectory || !repository) {
    throw new Error('usage: capture-visual-fidelity <head-sha> <base-sha> <output-directory> <owner/repository>');
  }
  const { artifactPath, evidence } = await captureVisualFidelityEvidence(
    headSha,
    baseSha,
    outputDirectory,
    repository,
  );
  const artifactSource = await import('node:fs/promises').then(({ readFile }) => readFile(artifactPath));
  console.log(`head=${headSha}`);
  console.log(`artifact=${artifactPath}`);
  console.log(`sha256=${createHash('sha256').update(artifactSource).digest('hex')}`);
  console.log(`result=${evidence.result}`);
  if (evidence.result === 'fail') process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1]!, 'file:').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
