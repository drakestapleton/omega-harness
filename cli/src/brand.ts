import chalk from 'chalk';

export const CLI_VERSION = '0.1.0';
export const SYMBOL = 'Ω';

/**
 * Custom Omega Harness banner — inspired by Gemini CLI's clean block aesthetic,
 * branded exclusively with Drake's Ω symbol.
 */
export const OMEGA_BANNER_LINES: string[] = [
  '   ██████╗    ██████╗ ███╗   ███╗███████╗ ██████╗  █████╗ ',
  '  ██╔═══██╗  ██╔═══██╗████╗ ████║██╔════╝██╔════╝ ██╔══██╗',
  '  ██║   ██║  ██║   ██║██╔████╔██║█████╗  ██║  ███╗███████║',
  '  ╚██╗ ██╔╝  ██║   ██║██║╚██╔╝██║██╔══╝  ██║   ██║██╔══██║',
  '  ███╝ ╚███╗ ╚██████╔╝██║ ╚═╝ ██║███████╗╚██████╔╝██║  ██║',
  '  ╚══╝  ╚══╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝',
];

export const OMEGA_BANNER_COMPACT: string[] = [
  '  ╔═╗  ╔═╗╔╦╗╔═╗╔═╗╔═╗',
  '  ║ ║  ║ ║║║║║╣ ║ ╦╠═╣',
  '  ╩ ╩  ╚═╝╩ ╩╚═╝╚═╝╩ ╩',
];

// Gradient palette per banner row (electric cyan -> sky -> indigo -> violet)
const BANNER_COLORS = [
  '#38BDF8',
  '#60A5FA',
  '#818CF8',
  '#A78BFA',
  '#C084FC',
  '#E879F9',
];

export function renderBanner(columns = 80): string[] {
  const lines = columns >= 64 ? OMEGA_BANNER_LINES : OMEGA_BANNER_COMPACT;
  return lines.map((line, i) => {
    const hex = BANNER_COLORS[i % BANNER_COLORS.length];
    return chalk.hex(hex).bold(line);
  });
}

export const THEME = {
  symbol: '#38BDF8',
  accent: '#818CF8',
  muted: '#64748B',
  border: '#334155',
  borderActive: '#38BDF8',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  userPrompt: '#E2E8F0',
  code: '#FDE68A',
} as const;
