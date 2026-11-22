import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import {
  CLI_VERSION,
  SYMBOL,
  THEME,
  renderBanner,
} from '../brand.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_INKLING_MODEL,
  RECOMMENDED_MODELS,
  detectGitBranch,
  formatShortPath,
  writePersistedConfig,
  type ApprovalMode,
  type OmegaConfig,
  type ProviderKind,
} from '../config.js';
import {
  buildSystemPrompt,
  compileAndRunOmFile,
  compileOmFile,
  discoverSkills,
  readPinInfo,
} from '../harness.js';
import {
  OmegaAgent,
  type ApprovalDecision,
  type TokenUsage,
  type ToolEvent,
} from '../agent.js';
import { probeInkling, type InklingHealth } from '../inkling.js';
import { TOOL_DECLARATIONS } from '../tools.js';
import { formatMemories } from '../state.js';
import { SLASH_COMMANDS, matchSlashCommands } from '../commands.js';
import { Markdown } from './Markdown.js';

interface TranscriptItem {
  id: string;
  kind: 'banner' | 'user' | 'assistant' | 'system' | 'error' | 'tool';
  text?: string;
  tool?: ToolEvent;
}

interface PendingApproval {
  event: ToolEvent;
  resolve: (decision: ApprovalDecision) => void;
}

export interface AppProps {
  config: OmegaConfig;
  cwd: string;
  initialPrompt?: string;
  initialSkills?: string[];
  resumeSession?: string;
}

const ToolCard: React.FC<{ tool: ToolEvent }> = ({ tool }) => {
  const icon =
    tool.status === 'success'
      ? '✓'
      : tool.status === 'error'
        ? '✗'
        : tool.status === 'denied'
          ? '⊘'
          : '…';
  const color =
    tool.status === 'success'
      ? THEME.success
      : tool.status === 'error'
        ? THEME.error
        : tool.status === 'denied'
          ? THEME.warning
          : THEME.symbol;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.border}
      paddingX={1}
      marginLeft={2}
      marginBottom={0}
    >
      <Box>
        {tool.status === 'running' ? (
          <Text color={THEME.symbol}>
            <Spinner type="dots" />{' '}
          </Text>
        ) : (
          <Text color={color} bold>
            {icon}{' '}
          </Text>
        )}
        <Text color={THEME.symbol} bold>
          {SYMBOL} {tool.name}
        </Text>
        {tool.argsPreview ? (
          <Text color={THEME.muted}> ({tool.argsPreview})</Text>
        ) : null}
      </Box>
      {tool.preview ? (
        <Box marginLeft={2}>
          <Text color={THEME.muted}>{tool.preview}</Text>
        </Box>
      ) : null}
    </Box>
  );
};

export const App: React.FC<AppProps> = ({
  config,
  cwd,
  initialPrompt,
  initialSkills = [],
  resumeSession,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout?.columns || 80;

  const [provider, setProvider] = useState<ProviderKind>(config.provider);
  const [endpoint, setEndpoint] = useState<string>(config.endpoint);
  const [apiKey, setApiKey] = useState<string | undefined>(config.apiKey);
  const [model, setModel] = useState<string>(config.model);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(config.approvalMode);
  const [activeSkills, setActiveSkills] = useState<string[]>(
    Array.from(new Set([...config.defaultSkills, ...initialSkills]))
  );
  const [inklingHealth, setInklingHealth] = useState<InklingHealth | null>(null);
  const [usage, setUsage] = useState<TokenUsage>({
    promptTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });

  const skills = useMemo(() => discoverSkills(config.harnessRoot), [config.harnessRoot]);
  const pinInfo = useMemo(
    () => readPinInfo(config.harnessRoot, config.omcPath),
    [config.harnessRoot, config.omcPath]
  );
  const gitBranch = useMemo(() => detectGitBranch(cwd), [cwd]);

  const [items, setItems] = useState<TranscriptItem[]>(() => [
    { id: 'banner-0', kind: 'banner' },
  ]);
  const [input, setInput] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const [busy, setBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [streamingText, setStreamingText] = useState('');
  const [liveTools, setLiveTools] = useState<ToolEvent[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const agentRef = useRef<OmegaAgent>(new OmegaAgent(apiKey));
  const abortRef = useRef<AbortController | null>(null);
  const initialSentRef = useRef(false);

  const pushItem = useCallback((item: Omit<TranscriptItem, 'id'>) => {
    setItems((prev) => [
      ...prev,
      { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
    ]);
  }, []);

  const refreshInklingHealth = useCallback(
    async (ep = endpoint, key = apiKey) => {
      const h = await probeInkling(ep, key);
      setInklingHealth(h);
      return h;
    },
    [endpoint, apiKey]
  );

  useEffect(() => {
    if (provider === 'inkling') {
      void refreshInklingHealth(endpoint, apiKey);
    }
  }, [provider, endpoint, apiKey, refreshInklingHealth]);

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [busy]);

  const runPrompt = useCallback(
    async (text: string) => {
      if (provider === 'gemini' && !apiKey) {
        pushItem({
          kind: 'error',
          text: 'No Gemini API key configured. Run `/auth <API_KEY>` or switch to `/provider inkling`.',
        });
        return;
      }

      pushItem({ kind: 'user', text });
      setBusy(true);
      setStreamingText('');
      setLiveTools([]);

      const controller = new AbortController();
      abortRef.current = controller;

      const systemInstruction = buildSystemPrompt({
        harnessRoot: config.harnessRoot,
        cwd,
        activeSkills,
        approvalMode,
        pinInfo,
      });

      const finishedTools: ToolEvent[] = [];

      try {
        const finalText = await agentRef.current.sendTurn(text, {
          provider,
          endpoint,
          apiKey,
          model,
          systemInstruction,
          toolContext: {
            cwd,
            harnessRoot: config.harnessRoot,
            omcPath: config.omcPath,
            approvalMode,
          },
          signal: controller.signal,
          callbacks: {
            onTextDelta: (chunk) => {
              setStreamingText((prev) => prev + chunk);
            },
            onToolStart: (ev) => {
              finishedTools.push(ev);
              setLiveTools([...finishedTools]);
            },
            onToolUpdate: (ev) => {
              const idx = finishedTools.findIndex((t) => t.id === ev.id);
              if (idx >= 0) finishedTools[idx] = ev;
              setLiveTools([...finishedTools]);
            },
            onRequestApproval: (ev) =>
              new Promise<ApprovalDecision>((resolve) => {
                setPendingApproval({ event: ev, resolve });
              }),
            onUsageUpdate: (u) => setUsage({ ...u }),
          },
        });

        for (const t of finishedTools) {
          pushItem({ kind: 'tool', tool: t });
        }
        if (finalText.trim()) {
          pushItem({ kind: 'assistant', text: finalText });
        }
        try {
          agentRef.current.saveSession('latest');
        } catch {
          // ignore persistence error
        }
        if (provider === 'inkling') {
          void refreshInklingHealth(endpoint, apiKey);
        }
      } catch (err: unknown) {
        for (const t of finishedTools) {
          pushItem({ kind: 'tool', tool: t });
        }
        const msg = err instanceof Error ? err.message : String(err);
        pushItem({ kind: 'error', text: msg });
      } finally {
        abortRef.current = null;
        setStreamingText('');
        setLiveTools([]);
        setBusy(false);
      }
    },
    [
      activeSkills,
      apiKey,
      approvalMode,
      config.harnessRoot,
      config.omcPath,
      cwd,
      endpoint,
      model,
      pinInfo,
      provider,
      pushItem,
      refreshInklingHealth,
    ]
  );

  useEffect(() => {
    if (resumeSession) {
      const res = agentRef.current.loadSession(resumeSession);
      if (res.ok) {
        setUsage({ ...agentRef.current.usage });
        pushItem({
          kind: 'system',
          text: `Resumed session "${resumeSession}" (${res.turns} previous turns, saved ${res.savedAt || 'earlier'}).`,
        });
      }
    }
  }, [resumeSession, pushItem]);

  useEffect(() => {
    if (initialPrompt && !initialSentRef.current) {
      initialSentRef.current = true;
      void runPrompt(initialPrompt);
    }
  }, [initialPrompt, runPrompt]);

  const handleSlashCommand = useCallback(
    async (raw: string) => {
      const parts = raw.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      switch (cmd) {
        case '/exit':
        case '/quit':
          exit();
          return;

        case '/help': {
          const lines = [
            `${SYMBOL} Omega Harness CLI v${CLI_VERSION} — Slash Commands`,
            '',
            ...SLASH_COMMANDS.map((c) => `  ${c.usage.padEnd(36)} ${c.description}`),
            '',
            'Shortcuts & Tips:',
            '  @path/to/file.om   Attach a file directly into your prompt',
            '  Up / Down          Browse prompt history',
            '  Ctrl+C             Cancel active generation (or exit when idle)',
          ];
          pushItem({ kind: 'system', text: lines.join('\n') });
          return;
        }

        case '/status': {
          const h = await refreshInklingHealth(endpoint, apiKey);
          const lines = [
            `Provider:        ${provider}`,
            `Inkling URL:     ${h.endpoint}`,
            `Status:          ${h.online ? 'ONLINE' : `OFFLINE (${h.error || 'unreachable'})`}`,
            `Engine:          ${h.engine}`,
            `Model:           ${h.model || model}`,
            ...(h.contextWindow !== undefined
              ? [`Context:         ${h.contextWindow.toLocaleString()} tokens/slot`]
              : []),
            ...(h.kvPrefixHits !== undefined
              ? [`KV Cache Hits:   ${h.kvPrefixHits}`]
              : []),
            ...(h.slotsMax !== undefined
              ? [`KV Slots:        ${h.slotsActive ?? 0} / ${h.slotsMax} active`]
              : []),
            ...(h.arborisTransitions !== undefined
              ? [
                  `Arboris:         ACTIVE (transitions=${h.arborisTransitions}, top8=${h.arborisTransitions > 0 ? ((100 * (h.arborisTop8Hits ?? 0)) / (h.arborisTransitions * 8)).toFixed(1) : '0.0'}%, top16=${h.arborisTransitions > 0 ? ((100 * (h.arborisTop16Hits ?? 0)) / (h.arborisTransitions * 8)).toFixed(1) : '0.0'}%)`,
                ]
              : []),
            ...(!h.online
              ? [
                  '',
                  'To connect to Inkling-2-Mini on Spark:',
                  '  1. On Spark: spark-window run build/inkling2/inkling2-serve',
                  '  2. Tunnel:   ssh -N -L 8080:127.0.0.1:8080 spark',
                ]
              : []),
          ];
          pushItem({ kind: h.online ? 'system' : 'error', text: lines.join('\n') });
          return;
        }

        case '/tools': {
          const lines = [
            `Ω Available Agent Tools (${TOOL_DECLARATIONS.length}):`,
            ...TOOL_DECLARATIONS.map((t) => `  • ${(t.name || '').padEnd(26)} ${t.description || ''}`),
          ];
          pushItem({ kind: 'system', text: lines.join('\n') });
          return;
        }

        case '/agents': {
          const out = agentRef.current.state.formatSubagents();
          pushItem({ kind: 'system', text: `Ω Subagents:\n${out}` });
          return;
        }

        case '/tasks': {
          const out = agentRef.current.state.formatTodos();
          pushItem({ kind: 'system', text: `Ω Session Tasks:\n${out}` });
          return;
        }

        case '/memory': {
          const out = formatMemories(arg || undefined);
          pushItem({ kind: 'system', text: `Ω Persistent Memory:\n${out}` });
          return;
        }

        case '/endpoint': {
          if (!arg) {
            pushItem({
              kind: 'system',
              text: `Current Inkling endpoint: ${endpoint}\nSwitch with: /endpoint http://127.0.0.1:8080`,
            });
            return;
          }
          const clean = arg.replace(/\/+$/, '');
          setEndpoint(clean);
          writePersistedConfig({ endpoint: clean });
          const h = await refreshInklingHealth(clean, apiKey);
          pushItem({
            kind: h.online ? 'system' : 'error',
            text: `Endpoint set to ${clean} (${h.online ? `ONLINE · ${h.engine}` : `OFFLINE: ${h.error}`})`,
          });
          return;
        }

        case '/provider': {
          if (!arg || (arg !== 'inkling' && arg !== 'gemini')) {
            pushItem({
              kind: 'system',
              text: `Active provider: ${provider}\nAvailable: inkling (default) | gemini\nUsage: /provider <inkling|gemini>`,
            });
            return;
          }
          const next = arg as ProviderKind;
          const nextModel = next === 'inkling' ? DEFAULT_INKLING_MODEL : DEFAULT_GEMINI_MODEL;
          setProvider(next);
          setModel(nextModel);
          writePersistedConfig({ provider: next, model: nextModel });
          pushItem({
            kind: 'system',
            text: `Switched provider to ${next} (model: ${nextModel}).`,
          });
          return;
        }

        case '/skills': {
          const lines = [
            `Omega Harness Skills (${skills.length} in ${formatShortPath(config.harnessRoot)}/skills):`,
            ...skills.map((s) => {
              const pinned = activeSkills.includes(s.name) ? ' [PINNED]' : '';
              return `  • ${s.name}${pinned} — ${s.description.slice(0, 92)}${s.description.length > 92 ? '…' : ''}`;
            }),
            '',
            'Use `/skill <name>` to pin/unpin a skill in the system prompt.',
          ];
          pushItem({ kind: 'system', text: lines.join('\n') });
          return;
        }

        case '/skill': {
          if (!arg) {
            pushItem({ kind: 'system', text: 'Usage: /skill <name>  (run /skills to list all)' });
            return;
          }
          const found = skills.find((s) => s.name.toLowerCase() === arg.toLowerCase());
          if (!found) {
            pushItem({ kind: 'error', text: `Unknown skill "${arg}". Run /skills to see available skills.` });
            return;
          }
          if (activeSkills.includes(found.name)) {
            setActiveSkills((prev) => prev.filter((x) => x !== found.name));
            pushItem({ kind: 'system', text: `Unpinned skill: ${found.name}` });
          } else {
            setActiveSkills((prev) => [...prev, found.name]);
            pushItem({ kind: 'system', text: `Pinned skill into active system prompt: ${found.name}` });
          }
          return;
        }

        case '/model': {
          if (!arg) {
            const recs = RECOMMENDED_MODELS[provider];
            const lines = [
              `Active model (${provider}): ${model}`,
              'Recommended models:',
              ...recs.map((m) => `  • ${m.id.padEnd(24)} ${m.note}`),
              'Switch with: /model <model-id>',
            ];
            pushItem({ kind: 'system', text: lines.join('\n') });
            return;
          }
          setModel(arg);
          writePersistedConfig({ model: arg });
          pushItem({ kind: 'system', text: `Switched model to ${arg} (saved as default).` });
          return;
        }

        case '/mode': {
          const valid: ApprovalMode[] = ['default', 'auto-edit', 'yolo', 'omega-only'];
          if (!arg || !valid.includes(arg as ApprovalMode)) {
            pushItem({
              kind: 'system',
              text: `Current mode: ${approvalMode}\nAvailable modes: ${valid.join(' | ')}\nUsage: /mode <mode>`,
            });
            return;
          }
          const next = arg as ApprovalMode;
          setApprovalMode(next);
          pushItem({ kind: 'system', text: `Approval mode set to: ${next}` });
          return;
        }

        case '/pin': {
          const lines = [
            `Harness root:    ${config.harnessRoot}`,
            `PIN omega-mv:    ${pinInfo.omegaMvCommit || '(missing)'}`,
            `PIN omc-sha256:  ${pinInfo.omcSha256 || '(missing)'}`,
            `Local omc:       ${pinInfo.localOmcPath || '(not found)'}`,
            `Local sha256:    ${pinInfo.localOmcSha256 || '(n/a)'}`,
            `Match:           ${pinInfo.pinMatches === undefined ? 'unknown' : pinInfo.pinMatches ? 'EXACT MATCH' : 'DIFFERENT (local/macOS build)'}`,
          ];
          pushItem({ kind: 'system', text: lines.join('\n') });
          return;
        }

        case '/compile': {
          if (!arg) {
            pushItem({ kind: 'system', text: 'Usage: /compile <file.om>' });
            return;
          }
          const res = compileOmFile(arg.startsWith('/') ? arg : `${cwd}/${arg}`, {
            omcPath: config.omcPath,
            harnessRoot: config.harnessRoot,
          });
          if (res.ok) {
            pushItem({
              kind: 'system',
              text: `✓ omc compile PASS: ${arg} (${res.binarySize} bytes)`,
            });
          } else {
            const extra = res.errorDoc
              ? `\n  meaning: ${res.errorDoc.meaning}${res.errorDoc.fix ? `\n  fix:     ${res.errorDoc.fix}` : ''}`
              : '';
            pushItem({ kind: 'error', text: `✗ omc compile FAIL: ${res.stderr}${extra}` });
          }
          return;
        }

        case '/run': {
          if (!arg) {
            pushItem({ kind: 'system', text: 'Usage: /run <file.om>' });
            return;
          }
          const res = compileAndRunOmFile(arg.startsWith('/') ? arg : `${cwd}/${arg}`, {
            omcPath: config.omcPath,
            harnessRoot: config.harnessRoot,
          });
          if (!res.compile.ok) {
            pushItem({ kind: 'error', text: `✗ omc compile FAIL: ${res.compile.stderr}` });
            return;
          }
          const out = [
            `compile: PASS (${res.compile.binarySize} bytes)`,
            `exit: ${res.exitCode ?? 'null'}${res.timedOut ? ' (TIMED OUT)' : ''}`,
            res.stdout ? `stdout:\n${res.stdout}` : '',
            res.stderr ? `stderr:\n${res.stderr}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          pushItem({ kind: res.exitCode === 0 ? 'system' : 'error', text: out });
          return;
        }

        case '/resume': {
          const name = arg || 'latest';
          const res = agentRef.current.loadSession(name);
          if (res.ok) {
            setUsage({ ...agentRef.current.usage });
            pushItem({
              kind: 'system',
              text: `✓ Resumed session "${name}" (${res.turns} turns, saved ${res.savedAt || 'earlier'}).`,
            });
          } else {
            pushItem({ kind: 'error', text: `No saved session named "${name}".` });
          }
          return;
        }

        case '/clear':
          agentRef.current.clearHistory();
          setItems([{ id: `banner-${Date.now()}`, kind: 'banner' }]);
          return;

        case '/compact': {
          setBusy(true);
          try {
            const summary = await agentRef.current.compactHistory({
              provider,
              model,
              endpoint,
              apiKey,
            });
            pushItem({ kind: 'system', text: `Session compacted:\n${summary}` });
          } catch (err: unknown) {
            pushItem({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
          } finally {
            setBusy(false);
          }
          return;
        }

        case '/stats': {
          const turns = agentRef.current.getTurnCount();
          const calls = agentRef.current.toolCallCount;
          pushItem({
            kind: 'system',
            text: [
              `Provider:     ${provider}${provider === 'inkling' ? ` (${endpoint})` : ''}`,
              `Model:        ${model}`,
              `Mode:         ${approvalMode}`,
              `Turns:        ${turns}`,
              `Tool calls:   ${calls}`,
              `Tokens:       ${usage.totalTokens.toLocaleString()} (in: ${usage.promptTokens.toLocaleString()}, out: ${usage.outputTokens.toLocaleString()})`,
              `Skills:       ${activeSkills.length ? activeSkills.join(', ') : '(on-demand)'}`,
            ].join('\n'),
          });
          return;
        }

        case '/auth': {
          if (!arg) {
            const status = apiKey
              ? `Configured (${apiKey.slice(0, 6)}…${apiKey.slice(-4)})`
              : provider === 'inkling'
                ? 'Not required for local Inkling (optional bearer token)'
                : 'Not configured';
            pushItem({
              kind: 'system',
              text: `API key: ${status}\nSet with: /auth <KEY>  (saved to ~/.config/omega-harness/config.json, mode 0600)`,
            });
            return;
          }
          writePersistedConfig({ apiKey: arg });
          setApiKey(arg);
          agentRef.current.setApiKey(arg);
          pushItem({
            kind: 'system',
            text: '✓ API key saved to ~/.config/omega-harness/config.json (0600).',
          });
          return;
        }

        default:
          pushItem({ kind: 'error', text: `Unknown command "${cmd}". Type /help for available commands.` });
      }
    },
    [
      activeSkills,
      apiKey,
      approvalMode,
      config.harnessRoot,
      config.omcPath,
      cwd,
      endpoint,
      exit,
      model,
      pinInfo,
      provider,
      pushItem,
      refreshInklingHealth,
      skills,
      usage,
    ]
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setInput('');
      setInputKey((k) => k + 1);
      setHistoryIdx(-1);

      if (!trimmed) return;
      setHistory((prev) => [trimmed, ...prev.slice(0, 99)]);

      if (trimmed.startsWith('/')) {
        void handleSlashCommand(trimmed);
      } else {
        void runPrompt(trimmed);
      }
    },
    [handleSlashCommand, runPrompt]
  );

  useInput((ch, key) => {
    if (pendingApproval) {
      const lower = ch.toLowerCase();
      if (lower === 'y' || key.return) {
        const p = pendingApproval;
        setPendingApproval(null);
        p.resolve('allow');
      } else if (lower === 'a') {
        const p = pendingApproval;
        setPendingApproval(null);
        p.resolve('always');
      } else if (lower === 'n' || key.escape) {
        const p = pendingApproval;
        setPendingApproval(null);
        p.resolve('deny');
      }
      return;
    }

    if (key.ctrl && ch === 'c') {
      if (busy && abortRef.current) {
        abortRef.current.abort();
      } else {
        exit();
      }
      return;
    }

    if (!busy && key.upArrow && history.length > 0) {
      const nextIdx = Math.min(history.length - 1, historyIdx + 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx]);
      setInputKey((k) => k + 1);
    } else if (!busy && key.downArrow) {
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx]);
      }
      setInputKey((k) => k + 1);
    }
  });

  const slashSuggestions = useMemo(() => matchSlashCommands(input), [input]);
  const bannerLines = useMemo(() => renderBanner(columns), [columns]);

  const inklingBadge =
    provider === 'inkling'
      ? inklingHealth === null
        ? 'probing…'
        : inklingHealth.online
          ? inklingHealth.slotsMax !== undefined
            ? `online · ${inklingHealth.slotsActive ?? 0}/${inklingHealth.slotsMax} slots`
            : 'online'
          : 'offline'
      : 'gemini-sdk';

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) => {
          if (item.kind === 'banner') {
            return (
              <Box key={item.id} flexDirection="column" marginBottom={1}>
                {bannerLines.map((line, i) => (
                  <Text key={i}>{line}</Text>
                ))}
                <Box marginTop={1} flexDirection="column" paddingLeft={2}>
                  <Text>
                    <Text color={THEME.symbol} bold>
                      {SYMBOL} Omega Harness CLI
                    </Text>
                    <Text color={THEME.muted}>
                      {' '}
                      v{CLI_VERSION} · {provider === 'inkling' ? `Inkling (${endpoint})` : 'Gemini SDK'} ·{' '}
                      {skills.length} skills · {pinInfo.localOmcPath ? 'omc ready' : 'omc not found'}
                    </Text>
                  </Text>
                  <Text color={THEME.muted}>
                    Type a prompt, <Text color={THEME.accent}>/status</Text> for Inkling health,{' '}
                    <Text color={THEME.accent}>/help</Text> for commands,{' '}
                    <Text color={THEME.accent}>@file</Text> to attach context.
                  </Text>
                </Box>
              </Box>
            );
          }

          if (item.kind === 'user') {
            return (
              <Box key={item.id} marginBottom={1}>
                <Text color={THEME.accent} bold>
                  &gt;{' '}
                </Text>
                <Text color={THEME.userPrompt} bold>
                  {item.text}
                </Text>
              </Box>
            );
          }

          if (item.kind === 'tool' && item.tool) {
            return (
              <Box key={item.id} marginBottom={0}>
                <ToolCard tool={item.tool} />
              </Box>
            );
          }

          if (item.kind === 'assistant') {
            return (
              <Box key={item.id} flexDirection="row" marginBottom={1}>
                <Text color={THEME.symbol} bold>
                  {SYMBOL}{' '}
                </Text>
                <Box flexDirection="column" flexGrow={1}>
                  <Markdown text={item.text || ''} />
                </Box>
              </Box>
            );
          }

          if (item.kind === 'error') {
            return (
              <Box key={item.id} marginBottom={1} paddingLeft={2}>
                <Text color={THEME.error}>✗ {item.text}</Text>
              </Box>
            );
          }

          return (
            <Box key={item.id} marginBottom={1} paddingLeft={2}>
              <Text color={THEME.muted}>{item.text}</Text>
            </Box>
          );
        }}
      </Static>

      {/* Live tool executions during active turn */}
      {liveTools.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}

      {/* Live streaming assistant text */}
      {streamingText ? (
        <Box flexDirection="row" marginBottom={1}>
          <Text color={THEME.symbol} bold>
            {SYMBOL}{' '}
          </Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown text={streamingText} />
          </Box>
        </Box>
      ) : null}

      {/* Interactive tool approval prompt */}
      {pendingApproval ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={THEME.warning}
          paddingX={1}
          marginY={1}
        >
          <Text color={THEME.warning} bold>
            {SYMBOL} Approve tool call: {pendingApproval.event.name}
          </Text>
          {pendingApproval.event.argsPreview ? (
            <Text color={THEME.userPrompt}>  {pendingApproval.event.argsPreview}</Text>
          ) : null}
          <Text color={THEME.muted}>
            Press <Text color={THEME.success} bold>[Y]</Text>es (Enter) ·{' '}
            <Text color={THEME.symbol} bold>[A]</Text>lways allow {pendingApproval.event.name} ·{' '}
            <Text color={THEME.error} bold>[N]</Text>o (Esc)
          </Text>
        </Box>
      ) : null}

      {/* Offline hint banner for Inkling when idle */}
      {!busy && provider === 'inkling' && inklingHealth && !inklingHealth.online ? (
        <Box paddingLeft={1} marginBottom={0}>
          <Text color={THEME.warning}>
            ! Inkling offline at {endpoint} — tunnel Spark: `ssh -N -L 8080:127.0.0.1:8080 spark` (or `/endpoint &lt;url&gt;`)
          </Text>
        </Box>
      ) : null}

      {/* Spinner when waiting */}
      {busy && !pendingApproval ? (
        <Box marginBottom={0} paddingLeft={1}>
          <Text color={THEME.symbol}>
            <Spinner type="dots" /> {SYMBOL} {provider === 'inkling' ? 'Inkling' : 'Gemini'} thinking… ({elapsedSec}s) · Ctrl+C to cancel
          </Text>
        </Box>
      ) : null}

      {/* Slash command autocomplete dropdown */}
      {!busy && slashSuggestions.length > 0 ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={THEME.border}
          paddingX={1}
          marginBottom={0}
        >
          {slashSuggestions.slice(0, 7).map((c) => (
            <Text key={c.name}>
              <Text color={THEME.symbol} bold>
                {c.usage.padEnd(34)}
              </Text>
              <Text color={THEME.muted}>{c.description}</Text>
            </Text>
          ))}
        </Box>
      ) : null}

      {/* Gemini-CLI-style bordered prompt input box with Ω symbol */}
      <Box
        borderStyle="round"
        borderColor={busy ? THEME.border : THEME.borderActive}
        paddingX={1}
      >
        <Text color={THEME.symbol} bold>
          {SYMBOL} &gt;{' '}
        </Text>
        {busy ? (
          <Text color={THEME.muted}>working…</Text>
        ) : (
          <TextInput
            key={inputKey}
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask Inkling anything, or type /help..."
          />
        )}
      </Box>

      {/* Bottom status bar */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text color={THEME.muted}>
          {formatShortPath(cwd)}
          {gitBranch ? ` (${gitBranch})` : ''}
        </Text>
        <Text color={THEME.muted}>
          <Text color={approvalMode === 'yolo' ? THEME.warning : THEME.accent}>
            [{approvalMode}]
          </Text>
          {activeSkills.length > 0 ? ` · ${activeSkills.length} pinned` : ''}
          {' · '}
          <Text color={THEME.symbol}>{model}</Text>
          {' · '}
          <Text
            color={
              provider === 'inkling'
                ? inklingHealth?.online
                  ? THEME.success
                  : THEME.warning
                : THEME.muted
            }
          >
            {inklingBadge}
          </Text>
          {usage.totalTokens > 0 ? ` · ${usage.totalTokens.toLocaleString()} tok` : ''}
        </Text>
      </Box>
    </Box>
  );
};
