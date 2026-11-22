import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from './config.js';

export interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface SubagentRecord {
  id: string;
  role: string;
  task: string;
  mode: 'read-only' | 'full';
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  finishedAt?: number;
  toolCalls: number;
  result?: string;
  error?: string;
}

export type SubagentRunner = (req: {
  id: string;
  role: string;
  task: string;
  mode: 'read-only' | 'full';
  existingId?: string;
}) => Promise<{ text: string; toolCalls: number }>;

export class SessionState {
  public todos: TodoItem[] = [];
  public subagents = new Map<string, SubagentRecord>();
  private subagentSeq = 0;
  public runSubagent?: SubagentRunner;

  setTodos(items: TodoItem[]): TodoItem[] {
    this.todos = items.map((it, idx) => ({
      id: it.id || String(idx + 1),
      title: String(it.title || '').trim(),
      status:
        it.status === 'in_progress' || it.status === 'completed'
          ? it.status
          : 'pending',
    }));
    return this.todos;
  }

  formatTodos(): string {
    if (this.todos.length === 0) return '(no tasks recorded)';
    return this.todos
      .map((t) => {
        const box = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
        return `${box} (${t.id}) ${t.title}`;
      })
      .join('\n');
  }

  nextSubagentId(role: string): string {
    this.subagentSeq += 1;
    const slug = role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 18) || 'worker';
    return `sub-${this.subagentSeq}-${slug}`;
  }

  registerSubagent(rec: SubagentRecord): void {
    this.subagents.set(rec.id, rec);
  }

  listSubagents(): SubagentRecord[] {
    return Array.from(this.subagents.values());
  }

  formatSubagents(): string {
    const list = this.listSubagents();
    if (list.length === 0) return '(no subagents spawned in this session)';
    return list
      .map((s) => {
        const dur = s.finishedAt ? `${((s.finishedAt - s.startedAt) / 1000).toFixed(1)}s` : 'running';
        const summary = (s.result || s.error || '').replace(/\s+/g, ' ').slice(0, 100);
        return `- ${s.id} [${s.role}] (${s.status}, ${s.mode}, ${s.toolCalls} tools, ${dur})${summary ? `: ${summary}` : ''}`;
      })
      .join('\n');
  }
}

function getMemoryPath(): string {
  return path.join(getConfigDir(), 'memory.json');
}

export function readMemories(): Record<string, { value: string; updatedAt: string }> {
  try {
    const raw = fs.readFileSync(getMemoryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, { value: string; updatedAt: string }>;
    }
  } catch {
    // missing or corrupt
  }
  return {};
}

export function saveMemory(key: string, value: string): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mem = readMemories();
  mem[key] = { value, updatedAt: new Date().toISOString() };
  fs.writeFileSync(getMemoryPath(), JSON.stringify(mem, null, 2) + '\n', { mode: 0o600 });
}

export function formatMemories(filterKey?: string): string {
  const mem = readMemories();
  if (filterKey) {
    const hit = mem[filterKey];
    if (!hit) return `No memory found for key "${filterKey}".`;
    return `${filterKey}: ${hit.value} (updated ${hit.updatedAt})`;
  }
  const entries = Object.entries(mem);
  if (entries.length === 0) return '(no persistent memories saved)';
  return entries.map(([k, v]) => `- ${k}: ${v.value}`).join('\n');
}
