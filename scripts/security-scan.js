#!/usr/bin/env node
/**
 * Cross-platform hardcoded-secret scanner.
 *
 * Scans source files for credentials that must never be committed: private
 * keys, cloud-provider tokens, API keys, and password assignments. Exits 1
 * when any secret is found, 0 otherwise.
 *
 * Pure Node.js — no platform-specific tools (grep/bash) required, so it runs
 * identically on Windows, macOS, Linux, and CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const SKIP_FILES = new Set(['package-lock.json', 'security-scan.js']);

const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
]);

const SECRET_PATTERNS = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
    message: 'Private key block',
  },
  {
    id: 'aws-access-key-id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'AWS access key ID',
  },
  {
    id: 'github-token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
    message: 'GitHub personal access token',
  },
  {
    id: 'github-fine-grained-token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    message: 'GitHub fine-grained personal access token',
  },
  {
    id: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    message: 'Slack token',
  },
  {
    id: 'openai-style-key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
    message: 'OpenAI-style API key',
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    message: 'JSON Web Token (e.g. Supabase key)',
  },
  {
    id: 'secret-assignment',
    pattern:
      /\b(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|pwd)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    message: 'Hardcoded credential assignment',
  },
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...walk(fullPath));
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const findings = [];
  const lines = content.split('\n');
  for (const { id, message, pattern } of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        findings.push({ id, message, line: i + 1 });
      }
    }
  }
  return findings;
}

const files = walk(rootDir).filter((file) => {
  const name = file.split(/[\\/]/).pop();
  if (SKIP_FILES.has(name)) return false;
  if (name.startsWith('.env')) return false;
  return SCANNABLE_EXTENSIONS.has(extname(name));
});

let totalFindings = 0;
for (const file of files) {
  const findings = scanFile(file);
  if (findings.length === 0) continue;
  totalFindings += findings.length;
  const rel = relative(rootDir, file);
  for (const finding of findings) {
    console.error(`✗ ${rel}:${finding.line}: ${finding.message} (${finding.id})`);
  }
}

if (totalFindings > 0) {
  console.error(`\nSecurity scan failed: ${totalFindings} potential hardcoded secret(s) found.`);
  process.exit(1);
}

console.log('✓ Security scan passed: no hardcoded secrets found.');
process.exit(0);
