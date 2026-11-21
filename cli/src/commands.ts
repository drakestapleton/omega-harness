export interface SlashCommandDef {
  name: string;
  usage: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/help', usage: '/help', description: 'Show commands and keyboard shortcuts' },
  { name: '/skills', usage: '/skills', description: 'List Omega Harness skills and active pins' },
  { name: '/skill', usage: '/skill <name>', description: 'Pin or unpin a skill in the system prompt' },
  { name: '/model', usage: '/model [id]', description: 'Show or switch the active Gemini model' },
  { name: '/mode', usage: '/mode [default|auto-edit|yolo|omega-only]', description: 'Switch tool approval / guard mode' },
  { name: '/pin', usage: '/pin', description: 'Show omega-harness PIN and local omc status' },
  { name: '/compile', usage: '/compile <file.om>', description: 'Compile an .om file locally with omc' },
  { name: '/run', usage: '/run <file.om>', description: 'Compile and run an .om file locally' },
  { name: '/compact', usage: '/compact', description: 'Compact conversation history to free context' },
  { name: '/clear', usage: '/clear', description: 'Clear conversation history and transcript' },
  { name: '/stats', usage: '/stats', description: 'Show session token usage and tool stats' },
  { name: '/auth', usage: '/auth [api-key]', description: 'Show or set your Gemini API key' },
  { name: '/exit', usage: '/exit', description: 'Exit Ω Omega Harness CLI' },
  { name: '/quit', usage: '/quit', description: 'Exit Ω Omega Harness CLI' },
];

export function matchSlashCommands(input: string): SlashCommandDef[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return [];
  const token = trimmed.split(/\s+/)[0].toLowerCase();
  if (trimmed.includes(' ')) return [];
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(token));
}
