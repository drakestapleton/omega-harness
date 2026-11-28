#!/usr/bin/env node
import fs from 'node:fs';
import {
  checkUrlsHttp200,
  formatLintReport,
  formatUrlCheckReport,
  lintPrePublishUrls,
  lintReceiptPaths,
} from './receipt-linter.js';

interface ParsedCli {
  mode: 'check' | 'urls' | 'all' | 'help';
  json: boolean;
  timeoutMs: number;
  allowLocalhost: boolean;
  ignorePatterns: RegExp[];
  targets: string[];
}

function parseCli(argv: string[]): ParsedCli {
  const out: ParsedCli = {
    mode: 'check',
    json: false,
    timeoutMs: 8000,
    allowLocalhost: false,
    ignorePatterns: [],
    targets: [],
  };

  let idx = 0;
  if (argv[0] === 'check' || argv[0] === 'urls' || argv[0] === 'all') {
    out.mode = argv[0];
    idx = 1;
  } else if (argv[0] === '-h' || argv[0] === '--help' || argv.length === 0) {
    out.mode = 'help';
    return out;
  }

  for (let i = idx; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.mode = 'help';
    } else if (a === '--json') {
      out.json = true;
    } else if (a === '--allow-localhost') {
      out.allowLocalhost = true;
    } else if (a === '--timeout-ms' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.timeoutMs = n;
    } else if (a === '--ignore-pattern' && argv[i + 1]) {
      out.ignorePatterns.push(new RegExp(argv[++i]));
    } else if (!a.startsWith('-')) {
      out.targets.push(a);
    }
  }

  return out;
}

function printUsage(): void {
  console.log(
    [
      'omega-receipt-lint — Static Receipt & Pre-Publish URL Honesty Linter (2026-11-28 Audit Standards)',
      '',
      'Usage:',
      '  omega-receipt-lint check <file|dir...> [--json]',
      '  omega-receipt-lint urls <file|url...> [--json] [--timeout-ms 8000] [--allow-localhost] [--ignore-pattern <regex>]',
      '  omega-receipt-lint all <file|dir...> [--json] [--timeout-ms 8000]',
      '',
      'Exit codes:',
      '  0  All checks passed',
      '  1  One or more hard-block audit findings or non-200 URLs',
      '  2  Usage or I/O error',
    ].join('\n')
  );
}

async function run(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.mode === 'help') {
    printUsage();
    process.exit(0);
  }

  if (cli.targets.length === 0) {
    const msg = 'No target files, directories, or URLs provided.';
    if (cli.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(`error: ${msg}`);
    }
    process.exit(2);
  }

  try {
    if (cli.mode === 'check') {
      const report = lintReceiptPaths(cli.targets);
      if (cli.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatLintReport(report));
      }
      process.exit(report.ok ? 0 : 1);
    }

    if (cli.mode === 'urls') {
      const directUrls: string[] = [];
      const files: string[] = [];
      for (const t of cli.targets) {
        if (/^https?:\/\//i.test(t)) {
          directUrls.push(t);
        } else {
          if (!fs.existsSync(t)) {
            throw new Error(`File not found: ${t}`);
          }
          files.push(t);
        }
      }

      const urlOpts = {
        timeoutMs: cli.timeoutMs,
        skipLocalhost: !cli.allowLocalhost,
        ignorePatterns: cli.ignorePatterns,
      };

      const fileReport =
        files.length > 0 ? await lintPrePublishUrls(files, urlOpts) : null;
      const directReport =
        directUrls.length > 0 ? await checkUrlsHttp200(directUrls, urlOpts) : null;

      const results = [
        ...(fileReport ? fileReport.results : []),
        ...(directReport ? directReport.results : []),
      ];
      const findings = [
        ...(fileReport ? fileReport.findings : []),
        ...(directReport ? directReport.findings : []),
      ];
      const passed = results.filter((r) => r.ok).length;
      const failed = results.length - passed;
      const combined = {
        ok: failed === 0,
        totalUrls: results.length,
        passed,
        failed,
        results,
        findings,
      };

      if (cli.json) {
        console.log(JSON.stringify(combined, null, 2));
      } else {
        console.log(formatUrlCheckReport(combined));
      }
      process.exit(combined.ok ? 0 : 1);
    }

    // mode === 'all'
    const receiptReport = lintReceiptPaths(cli.targets);
    const filesForUrls = receiptReport.reports
      .map((r) => r.file)
      .filter((f): f is string => Boolean(f));
    const urlReport = await lintPrePublishUrls(filesForUrls, {
      timeoutMs: cli.timeoutMs,
      skipLocalhost: !cli.allowLocalhost,
      ignorePatterns: cli.ignorePatterns,
    });
    const combinedOk = receiptReport.ok && urlReport.ok;

    if (cli.json) {
      console.log(
        JSON.stringify(
          {
            ok: combinedOk,
            receipts: receiptReport,
            urls: urlReport,
          },
          null,
          2
        )
      );
    } else {
      console.log(formatLintReport(receiptReport));
      console.log('');
      console.log(formatUrlCheckReport(urlReport));
    }
    process.exit(combinedOk ? 0 : 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cli.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(`error: ${msg}`);
    }
    process.exit(2);
  }
}

run();
