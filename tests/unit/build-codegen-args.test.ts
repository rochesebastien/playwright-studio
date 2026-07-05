import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// recorder-runner importe ./paths qui importe 'electron' au chargement du module.
// On fournit un mock minimal : les fonctions testées ici (buildCodegenArgs,
// buildChildEnv, buildA2Config) sont pures et n'appellent jamais app.*.
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/repo',
    isPackaged: false,
    get resourcesPath() {
      return '/resources';
    },
  },
}));

import {
  buildCodegenArgs,
  buildChildEnv,
  buildA2Config,
} from '../../src/main/recorder-runner';
import type { RecorderOptions } from '../../src/shared/types';

/** Options de base valides (mode direct). */
function baseOptions(over: Partial<RecorderOptions> = {}): RecorderOptions {
  return {
    engine: 'codegen',
    browser: 'chromium',
    target: 'playwright-test',
    outputPath: '/out/spec.ts',
    proxy: { mode: 'direct' },
    ...over,
  };
}

const FORBIDDEN = [
  '--user-data-dir',
  '--save-storage',
  '--load-storage',
  '--incognito',
];

function assertNoForbidden(args: string[]): void {
  const joined = args.join(' ');
  for (const flag of FORBIDDEN) {
    expect(joined).not.toContain(flag);
  }
}

describe('buildCodegenArgs — flags de base', () => {
  it('inclut toujours --target et --output', () => {
    const args = buildCodegenArgs(baseOptions());
    expect(args).toContain('--target');
    expect(args[args.indexOf('--target') + 1]).toBe('playwright-test');
    expect(args).toContain('--output');
    expect(args[args.indexOf('--output') + 1]).toBe('/out/spec.ts');
  });

  it('respecte la valeur de --target (autre langage)', () => {
    const args = buildCodegenArgs(baseOptions({ target: 'python-pytest' }));
    expect(args[args.indexOf('--target') + 1]).toBe('python-pytest');
  });

  it("--target vient avant --output, dans un ordre cohérent", () => {
    const args = buildCodegenArgs(baseOptions());
    expect(args.indexOf('--target')).toBeLessThan(args.indexOf('--output'));
  });

  it("ne contient JAMAIS d'options d'isolation interdites (mode direct)", () => {
    assertNoForbidden(buildCodegenArgs(baseOptions()));
  });
});

describe('buildCodegenArgs — proxy direct', () => {
  it('ajoute --proxy-server=direct:// ET --proxy-bypass=* (recette validée DECISIONS.md Q1)', () => {
    const args = buildCodegenArgs(baseOptions({ proxy: { mode: 'direct' } }));
    expect(args).toContain('--proxy-server=direct://');
    // Sans le wildcard, Playwright réécrit direct:// en http://direct (proxy
    // inexistant) et toute navigation non-loopback échoue.
    expect(args).toContain('--proxy-bypass=*');
  });
});

describe('buildCodegenArgs — proxy manual', () => {
  it('avec server sans bypass → --proxy-server=<server>, pas de --proxy-bypass', () => {
    const args = buildCodegenArgs(
      baseOptions({ proxy: { mode: 'manual', server: 'http://proxy.corp:8080' } }),
    );
    expect(args).toContain('--proxy-server=http://proxy.corp:8080');
    expect(args.join(' ')).not.toContain('--proxy-bypass');
  });

  it('avec server et bypass → les deux flags', () => {
    const args = buildCodegenArgs(
      baseOptions({
        proxy: {
          mode: 'manual',
          server: 'http://proxy.corp:8080',
          bypass: '.corp.local,localhost',
        },
      }),
    );
    expect(args).toContain('--proxy-server=http://proxy.corp:8080');
    expect(args).toContain('--proxy-bypass=.corp.local,localhost');
  });

  it('manual sans server → aucun flag proxy (rien de bancal)', () => {
    const args = buildCodegenArgs(baseOptions({ proxy: { mode: 'manual' } }));
    expect(args.join(' ')).not.toContain('--proxy-server');
    expect(args.join(' ')).not.toContain('--proxy-bypass');
  });
});

describe('buildCodegenArgs — proxy system', () => {
  it("n'ajoute AUCUN flag proxy (héritage système)", () => {
    const args = buildCodegenArgs(baseOptions({ proxy: { mode: 'system' } }));
    expect(args.join(' ')).not.toContain('--proxy-server');
    expect(args.join(' ')).not.toContain('--proxy-bypass');
  });
});

describe('buildCodegenArgs — viewport, device, startUrl', () => {
  it('ajoute --viewport-size=w,h quand viewport fourni', () => {
    const args = buildCodegenArgs(
      baseOptions({ viewport: { width: 1280, height: 720 } }),
    );
    expect(args).toContain('--viewport-size=1280,720');
  });

  it("n'ajoute pas de viewport quand absent", () => {
    const args = buildCodegenArgs(baseOptions());
    expect(args.join(' ')).not.toContain('--viewport-size');
  });

  it('ajoute --device=<device> quand fourni', () => {
    const args = buildCodegenArgs(baseOptions({ device: 'iPhone 15' }));
    expect(args).toContain('--device=iPhone 15');
  });

  it('place startUrl en dernier argument positionnel', () => {
    const args = buildCodegenArgs(
      baseOptions({
        startUrl: 'https://example.com',
        viewport: { width: 800, height: 600 },
        device: 'iPhone 15',
      }),
    );
    expect(args[args.length - 1]).toBe('https://example.com');
  });

  it('startUrl vide ou blanc → non ajouté (dernier arg reste un flag connu)', () => {
    // Sans startUrl utile, le dernier argument est le bypass du mode direct.
    const argsEmpty = buildCodegenArgs(baseOptions({ startUrl: '' }));
    expect(argsEmpty[argsEmpty.length - 1]).toBe('--proxy-bypass=*');

    const argsBlank = buildCodegenArgs(baseOptions({ startUrl: '   ' }));
    expect(argsBlank[argsBlank.length - 1]).toBe('--proxy-bypass=*');
    // aucune chaîne blanche positionnelle glissée dans les args
    expect(argsBlank.some((a) => a.trim() === '' && a.length > 0)).toBe(false);
  });

  it('reste exempt de flags interdits quel que soit l’input (combinaison complète)', () => {
    const args = buildCodegenArgs(
      baseOptions({
        engine: 'codegen',
        startUrl: 'https://corp.local',
        target: 'javascript',
        proxy: {
          mode: 'manual',
          server: 'http://p:8080',
          bypass: 'localhost',
        },
        viewport: { width: 1024, height: 768 },
        device: 'Pixel 7',
      }),
    );
    assertNoForbidden(args);
  });
});

describe('buildCodegenArgs — navigateur (channel)', () => {
  it('msedge → ajoute --channel=msedge', () => {
    const args = buildCodegenArgs(baseOptions({ browser: 'msedge' }));
    expect(args).toContain('--channel=msedge');
  });

  it('chromium → aucun --channel (défaut)', () => {
    const args = buildCodegenArgs(baseOptions({ browser: 'chromium' }));
    expect(args.join(' ')).not.toContain('--channel');
  });

  it('msedge n’introduit aucun flag interdit et garde startUrl en dernier', () => {
    const args = buildCodegenArgs(
      baseOptions({ browser: 'msedge', startUrl: 'https://example.com' }),
    );
    assertNoForbidden(args);
    expect(args[args.length - 1]).toBe('https://example.com');
  });
});

describe('buildA2Config — navigateur (channel)', () => {
  it('msedge → channel: "msedge"', () => {
    const cfg = buildA2Config(
      baseOptions({ engine: 'api', browser: 'msedge' }),
      '/opt/pw-browsers',
    );
    expect(cfg.channel).toBe('msedge');
  });

  it('chromium → channel undefined', () => {
    const cfg = buildA2Config(
      baseOptions({ engine: 'api', browser: 'chromium' }),
      '/opt/pw-browsers',
    );
    expect(cfg.channel).toBeUndefined();
  });
});

describe('buildChildEnv', () => {
  const saved = {
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING,
  };

  beforeEach(() => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096';
    process.env.ELECTRON_ENABLE_LOGGING = '1';
  });

  afterEach(() => {
    if (saved.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = saved.NODE_OPTIONS;
    if (saved.ELECTRON_ENABLE_LOGGING === undefined)
      delete process.env.ELECTRON_ENABLE_LOGGING;
    else process.env.ELECTRON_ENABLE_LOGGING = saved.ELECTRON_ENABLE_LOGGING;
  });

  it("pose ELECTRON_RUN_AS_NODE='1' et PLAYWRIGHT_BROWSERS_PATH", () => {
    const env = buildChildEnv('/opt/pw-browsers');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('/opt/pw-browsers');
  });

  it('pose PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1 (direct doit couvrir le loopback)', () => {
    const env = buildChildEnv('/opt/pw-browsers');
    expect(env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK).toBe('1');
  });

  it('retire NODE_OPTIONS et ELECTRON_ENABLE_LOGGING même présents', () => {
    const env = buildChildEnv('/opt/pw-browsers');
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.ELECTRON_ENABLE_LOGGING).toBeUndefined();
  });

  it('ne mute pas le process.env courant', () => {
    buildChildEnv('/opt/pw-browsers');
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    expect(process.env.ELECTRON_ENABLE_LOGGING).toBe('1');
  });
});

describe('buildA2Config — traduction ProxyConfig → proxy Playwright', () => {
  it('direct → noProxyServer=true et PAS d’option proxy (arg brut --no-proxy-server côté runner)', () => {
    const cfg = buildA2Config(
      baseOptions({ engine: 'api', proxy: { mode: 'direct' } }),
      '/opt/pw-browsers',
    );
    expect(cfg.noProxyServer).toBe(true);
    expect(cfg.proxy).toBeUndefined();
  });

  it('system → proxy undefined', () => {
    const cfg = buildA2Config(
      baseOptions({ engine: 'api', proxy: { mode: 'system' } }),
      '/opt/pw-browsers',
    );
    expect(cfg.proxy).toBeUndefined();
  });

  it('manual avec server+bypass → { server, bypass }', () => {
    const cfg = buildA2Config(
      baseOptions({
        engine: 'api',
        proxy: { mode: 'manual', server: 'http://p:8080', bypass: 'localhost' },
      }),
      '/opt/pw-browsers',
    );
    expect(cfg.proxy).toEqual({ server: 'http://p:8080', bypass: 'localhost' });
  });

  it('manual avec server sans bypass → { server } (pas de clé bypass)', () => {
    const cfg = buildA2Config(
      baseOptions({
        engine: 'api',
        proxy: { mode: 'manual', server: 'http://p:8080' },
      }),
      '/opt/pw-browsers',
    );
    expect(cfg.proxy).toEqual({ server: 'http://p:8080' });
    expect(cfg.proxy && 'bypass' in cfg.proxy).toBe(false);
  });

  it('manual sans server → proxy undefined', () => {
    const cfg = buildA2Config(
      baseOptions({ engine: 'api', proxy: { mode: 'manual' } }),
      '/opt/pw-browsers',
    );
    expect(cfg.proxy).toBeUndefined();
  });

  it('propage browsersPath, startUrl, viewport, extraHeaders', () => {
    const cfg = buildA2Config(
      baseOptions({
        engine: 'api',
        startUrl: 'https://x.test',
        viewport: { width: 640, height: 480 },
        extraHeaders: { 'X-Env': 'test' },
      }),
      '/opt/pw-browsers',
    );
    expect(cfg.browsersPath).toBe('/opt/pw-browsers');
    expect(cfg.startUrl).toBe('https://x.test');
    expect(cfg.viewport).toEqual({ width: 640, height: 480 });
    expect(cfg.extraHeaders).toEqual({ 'X-Env': 'test' });
  });
});
