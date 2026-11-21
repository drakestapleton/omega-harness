import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type ApprovalMode = 'default' | 'auto-edit' | 'yolo' | 'omega-only';
export type ProviderKind = 'inkling' | 'gemini';

export interface OmegaConfig {
  provider: ProviderKind;
  endpoint: string;
  apiKey?: string;
  model: string;
  approvalMode: ApprovalMode;
  omcPath?: string;
  harnessRoot: string;
  defaultSkills: string[];
}

export interface PersistedConfig {
  provider?: ProviderKind;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  approvalMode?: ApprovalMode;
  omcPath?: string;
  defaultSkills?: string[];
}

export const DEFAULT_PROVIDER: ProviderKind = 'inkling';
export const DEFAULT_INKLING_ENDPOINT = 'http://127.0.0.1:8080';
export const DEFAULT_INKLING_MODEL = 'inkling-2-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

export const RECOMMENDED_MODELS: Record<ProviderKind, Array<{ id: string; note: string }>> = {
  inkling: [
    { id: 'inkling-2-mini', note: 'Inkling-2-Mini (pure seeded-Omega GB10 zero-CUDA server)' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', note: 'Best for complex Omega & systems engineering' },
    { id: 'gemini-2.5-flash', note: 'Fast everyday coding & iteration' },
    { id: 'gemini-2.5-flash-lite', note: 'Lightweight, lowest latency' },
    { id: 'gemini-3-pro-preview', note: 'Preview next-gen reasoning' },
  ],
};

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg || path.join(os.homedir(), '.config'), 'omega-harness');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function detectHarnessRoot(): string {
  if (process.env.OMEGA_HARNESS_ROOT && fs.existsSync(process.env.OMEGA_HARNESS_ROOT)) {
    return path.resolve(process.env.OMEGA_HARNESS_ROOT);
  }
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(thisDir, '..', '..');
  if (fs.existsSync(path.join(candidate, 'PIN')) && fs.existsSync(path.join(candidate, 'skills'))) {
    return candidate;
  }
  const fallback = path.join(os.homedir(), 'workspace', 'omega-harness');
  if (fs.existsSync(path.join(fallback, 'skills'))) {
    return fallback;
  }
  return candidate;
}

export function detectOmcPath(configured?: string): string | undefined {
  const candidates = [
    process.env.OMEGA_OMC,
    process.env.OMC,
    configured,
    path.join(os.homedir(), '.local', 'bin', 'omc'),
    path.join(os.homedir(), '.local', 'share', 'aien-omega', 'omc'),
  ].filter((p): p is string => Boolean(p));

  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // keep searching
    }
  }

  try {
    const found = execFileSync('which', ['omc'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (found) return found;
  } catch {
    // not in PATH
  }
  return undefined;
}

export function readPersistedConfig(): PersistedConfig {
  const cfgPath = getConfigPath();
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as PersistedConfig;
    }
  } catch {
    // missing or invalid config
  }
  return {};
}

export function writePersistedConfig(patch: Partial<PersistedConfig>): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const current = readPersistedConfig();
  const next: PersistedConfig = { ...current, ...patch };
  const cfgPath = getConfigPath();
  fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}

export function loadConfig(overrides: Partial<OmegaConfig> = {}): OmegaConfig {
  const persisted = readPersistedConfig();

  const envProvider = process.env.OMEGA_PROVIDER?.toLowerCase();
  const provider: ProviderKind =
    overrides.provider ||
    (envProvider === 'gemini' || envProvider === 'inkling' ? envProvider : undefined) ||
    persisted.provider ||
    DEFAULT_PROVIDER;

  const endpoint = (
    overrides.endpoint ||
    process.env.INKLING_URL ||
    process.env.OMEGA_ENDPOINT ||
    persisted.endpoint ||
    DEFAULT_INKLING_ENDPOINT
  ).replace(/\/+$/, '');

  const apiKey =
    overrides.apiKey ||
    (provider === 'inkling'
      ? process.env.INKLING_API_KEY
      : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ||
    persisted.apiKey;

  const defaultModelForProvider =
    provider === 'inkling' ? DEFAULT_INKLING_MODEL : DEFAULT_GEMINI_MODEL;

  const model =
    overrides.model ||
    process.env.OMEGA_MODEL ||
    (provider === 'inkling' ? process.env.INKLING_MODEL : process.env.GEMINI_MODEL) ||
    persisted.model ||
    defaultModelForProvider;

  const approvalMode: ApprovalMode =
    overrides.approvalMode ||
    persisted.approvalMode ||
    'default';

  const harnessRoot = overrides.harnessRoot || detectHarnessRoot();
  const omcPath = detectOmcPath(overrides.omcPath || persisted.omcPath);
  const defaultSkills = overrides.defaultSkills || persisted.defaultSkills || [];

  return {
    provider,
    endpoint,
    apiKey,
    model,
    approvalMode,
    omcPath,
    harnessRoot,
    defaultSkills,
  };
}

export function formatShortPath(p: string): string {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

export function detectGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
