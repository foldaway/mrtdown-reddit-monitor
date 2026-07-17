import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const today = new Date();
const maximumAgeDays = 180;
const failures = [];

const requiredFiles = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'docs/README.md',
  'docs/QUALITY.md',
  'docs/RELIABILITY.md',
  'docs/SECURITY.md',
  'docs/design-docs/core-beliefs.md',
  'docs/design-docs/index.md',
  'docs/exec-plans/README.md',
  'docs/exec-plans/active/README.md',
  'docs/exec-plans/completed/README.md',
  'docs/product-specs/index.md',
];

const indexedDirectories = [
  ['docs/design-docs', 'docs/design-docs/index.md'],
  ['docs/exec-plans/active', 'docs/exec-plans/active/README.md'],
  ['docs/exec-plans/completed', 'docs/exec-plans/completed/README.md'],
  ['docs/product-specs', 'docs/product-specs/index.md'],
];

async function isFile(relativePath) {
  try {
    return (await stat(path.join(root, relativePath))).isFile();
  } catch {
    return false;
  }
}

async function listMarkdownFiles(directory) {
  const results = [];
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory())
      results.push(...(await listMarkdownFiles(relativePath)));
    if (entry.isFile() && entry.name.endsWith('.md'))
      results.push(relativePath);
  }

  return results;
}

for (const relativePath of requiredFiles) {
  if (!(await isFile(relativePath))) {
    failures.push(
      `Missing required repository knowledge file: ${relativePath}`,
    );
  }
}

if (await isFile('AGENTS.md')) {
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const lineCount = agents.trimEnd().split('\n').length;
  if (lineCount > 120) {
    failures.push(
      `AGENTS.md is ${lineCount} lines; keep the map at or below 120 lines`,
    );
  }

  for (const expectedLink of [
    'ARCHITECTURE.md',
    'docs/README.md',
    'docs/QUALITY.md',
  ]) {
    if (!agents.includes(expectedLink)) {
      failures.push(`AGENTS.md must point agents to ${expectedLink}`);
    }
  }

  for (const commitPolicy of [
    'Conventional Commits',
    'Co-authored-by: Codex <codex@openai.com>',
  ]) {
    if (!agents.includes(commitPolicy)) {
      failures.push(`AGENTS.md must preserve commit policy: ${commitPolicy}`);
    }
  }
}

for (const [directory, indexFile] of indexedDirectories) {
  if (!(await isFile(indexFile))) continue;

  const index = await readFile(path.join(root, indexFile), 'utf8');
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name);
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.md') ||
      relativePath === indexFile
    )
      continue;
    if (!index.includes(entry.name)) {
      failures.push(`${indexFile} does not link to ${entry.name}`);
    }
  }
}

const markdownFiles = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'README.md',
  ...(await listMarkdownFiles('docs')),
];

for (const relativePath of markdownFiles) {
  const contents = await readFile(path.join(root, relativePath), 'utf8');
  const links = contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);

  for (const match of links) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;

    const absoluteTarget = path.resolve(
      root,
      path.dirname(relativePath),
      target,
    );
    const repositoryRelativeTarget = path.relative(root, absoluteTarget);
    if (repositoryRelativeTarget.startsWith('..')) continue;
    if (!(await isFile(repositoryRelativeTarget))) {
      failures.push(`${relativePath} links to missing file ${target}`);
    }
  }
}

const knowledgeFiles = [
  'ARCHITECTURE.md',
  'docs/QUALITY.md',
  'docs/RELIABILITY.md',
  'docs/SECURITY.md',
  'docs/design-docs/core-beliefs.md',
];

for (const relativePath of knowledgeFiles) {
  if (!(await isFile(relativePath))) continue;

  const contents = await readFile(path.join(root, relativePath), 'utf8');
  const match = contents.match(/^Last verified: (\d{4}-\d{2}-\d{2})$/m);
  if (!match) {
    failures.push(
      `${relativePath} must contain a Last verified: YYYY-MM-DD line`,
    );
    continue;
  }

  const verifiedAt = new Date(`${match[1]}T00:00:00Z`);
  const ageDays = Math.floor(
    (today.getTime() - verifiedAt.getTime()) / 86_400_000,
  );
  if (ageDays < 0)
    failures.push(`${relativePath} has a future Last verified date`);
  if (ageDays > maximumAgeDays) {
    failures.push(
      `${relativePath} was last verified ${ageDays} days ago; limit is ${maximumAgeDays}`,
    );
  }
}

if (failures.length > 0) {
  console.error('Repository knowledge validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Repository knowledge is structured, indexed, and fresh.');
}
