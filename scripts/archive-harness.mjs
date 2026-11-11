#!/usr/bin/env node
/**
 * Harness 状态文件归档脚本（无第三方依赖）。
 *
 * 规则见 AGENTS.md「归档」一节：
 * - feature_list.json：status 为 done / superseded 的 feature 移入 docs/archive/features/YYYY-MM.json（按 updatedAt 分月）。
 * - progress.md：只保留日期最新的一段与所有 Notes 段，其余移入 docs/archive/progress/YYYY-MM.md（按段落标题日期分月）。
 * - session-handoff.md：只保留日期最新的一轮，其余移入 docs/archive/handoffs/YYYY-MM.md。
 *
 * 用法：node scripts/archive-harness.mjs [--dry-run]
 * 幂等：重复执行不产生重复归档（feature 按 id 去重、md 段落按标题去重）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ARCHIVE_ROOT = path.join(ROOT, 'docs', 'archive');
const DRY_RUN = process.argv.includes('--dry-run');

const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const monthFromTitle = (title) => title.match(/(\d{4}-\d{2})-\d{2}/)?.[1] ?? currentMonth();
const dateFromTitle = (title) => title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';

/** 把 markdown 全文拆成「头部 + 若干 ## 段落」，保留原文（含空行），不改动内容。 */
function splitMarkdown(raw) {
  const lines = raw.split('\n');
  const first = lines.findIndex((line) => line.startsWith('## '));
  if (first === -1) return { header: raw, sections: [] };
  const header = lines.slice(0, first).join('\n');
  const sections = [];
  let current = null;
  for (const line of lines.slice(first)) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { title: line, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return {
    header,
    sections: sections.map((section) => ({ title: section.title, raw: section.lines.join('\n') })),
  };
}

/** 把 md 段落按月追加进归档文件；标题已存在于目标文件的段落跳过（幂等）。 */
function archiveMarkdownSections(kindDir, fileTitle, sections) {
  const moved = [];
  const byMonth = new Map();
  for (const section of sections) {
    const month = monthFromTitle(section.title);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(section);
  }
  for (const [month, monthSections] of byMonth) {
    const dir = path.join(ARCHIVE_ROOT, kindDir);
    const target = path.join(dir, `${month}.md`);
    const existing = readIfExists(target);
    const fresh = monthSections.filter((section) => !existing?.includes(section.title));
    if (fresh.length === 0) continue;
    if (!DRY_RUN) fs.mkdirSync(dir, { recursive: true });
    let content = existing ?? `# ${fileTitle}（${month}）\n\n由 scripts/archive-harness.mjs 自动归档；段内按归档时原文件顺序（时间倒序）排列。\n\n`;
    if (!content.endsWith('\n\n')) content = `${content.trimEnd()}\n\n`;
    for (const section of fresh) content += `${section.raw.trimEnd()}\n\n`;
    if (!DRY_RUN) fs.writeFileSync(target, content, 'utf8');
    moved.push({ target: path.relative(ROOT, target), count: fresh.length });
  }
  return moved;
}

/** 把 done/superseded feature 按月并入归档 JSON；按 id 去重（幂等）。 */
function archiveFeatures(features) {
  const moved = [];
  const byMonth = new Map();
  for (const feature of features) {
    const month = (feature.updatedAt ?? '').slice(0, 7) || currentMonth();
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(feature);
  }
  for (const [month, monthFeatures] of byMonth) {
    const dir = path.join(ARCHIVE_ROOT, 'features');
    const target = path.join(dir, `${month}.json`);
    const existing = readIfExists(target);
    let archived = [];
    if (existing) {
      try {
        archived = JSON.parse(existing);
      } catch {
        console.error(`[archive] ${path.relative(ROOT, target)} 不是合法 JSON，跳过该月`);
        continue;
      }
    }
    const seen = new Set(archived.map((feature) => feature.id));
    const fresh = monthFeatures.filter((feature) => !seen.has(feature.id));
    if (fresh.length === 0) continue;
    if (!DRY_RUN) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify([...archived, ...fresh], null, 2)}\n`, 'utf8');
    }
    moved.push({ target: path.relative(ROOT, target), count: fresh.length });
  }
  return moved;
}

function archiveFeatureList() {
  const file = path.join(ROOT, 'feature_list.json');
  const raw = readIfExists(file);
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('[archive] feature_list.json 不是合法 JSON，跳过（请先修复再归档）');
    return null;
  }
  const features = Array.isArray(data.features) ? data.features : [];
  const keep = features.filter((feature) => feature.status !== 'done' && feature.status !== 'superseded');
  const out = features.filter((feature) => feature.status === 'done' || feature.status === 'superseded');
  if (out.length === 0) return { moved: [], kept: keep.length };
  if (!DRY_RUN) {
    fs.writeFileSync(file, `${JSON.stringify({ archive: 'docs/archive/features/', features: keep }, null, 2)}\n`, 'utf8');
  }
  return { moved: archiveFeatures(out), kept: keep.length };
}

/** progress.md：保留日期最新的一段 + Notes 段；handoff：保留日期最新的一段。 */
function archiveMarkdownFile(fileName, kindDir, fileTitle, headerTemplate, keepNotes) {
  const file = path.join(ROOT, fileName);
  const raw = readIfExists(file);
  if (!raw) return null;
  const { sections } = splitMarkdown(raw);
  if (sections.length <= (keepNotes ? 0 : 1) && (!keepNotes || sections.every((s) => /^## Notes/.test(s.title)))) {
    return { moved: [], kept: sections.length };
  }
  let keepIndex = 0;
  for (let i = 1; i < sections.length; i += 1) {
    const best = dateFromTitle(sections[keepIndex].title);
    const current = dateFromTitle(sections[i].title);
    if (current && (!best || current > best)) keepIndex = i;
  }
  const keep = [];
  const out = [];
  sections.forEach((section, index) => {
    const isNotes = /^## Notes/.test(section.title);
    if (index === keepIndex || (keepNotes && isNotes)) keep.push(section);
    else out.push(section);
  });
  if (out.length === 0) return { moved: [], kept: keep.length };
  if (!DRY_RUN) {
    const body = [headerTemplate, ...keep.map((section) => section.raw.trimEnd())].join('\n\n');
    fs.writeFileSync(file, `${body}\n\n`, 'utf8');
  }
  return { moved: archiveMarkdownSections(kindDir, fileTitle, out), kept: keep.length };
}

const PROGRESS_HEADER = `# Progress

只保留日期最新的一段与 Notes；更早的条目由 \`node scripts/archive-harness.mjs\` 归档到 \`docs/archive/progress/\`（按月分文件）。
新的段落加在最上面（时间倒序）。`;

const HANDOFF_HEADER = `# Current Session Handoff

只保留最近一轮交接；更早轮次由 \`node scripts/archive-harness.mjs\` 归档到 \`docs/archive/handoffs/\`（按月分文件）。
新一轮的「本轮」段落加在最上面。`;

function ensureArchiveReadme() {
  const target = path.join(ARCHIVE_ROOT, 'README.md');
  if (readIfExists(target)) return false;
  const content = `# docs/archive

harness 状态文件的归档区，由 \`scripts/archive-harness.mjs\` 维护（规则与触发时机见根目录 AGENTS.md「归档」一节）：

- \`features/YYYY-MM.json\` — \`feature_list.json\` 中已 done / superseded 的 feature（按 updatedAt 分月，按 id 去重）
- \`progress/YYYY-MM.md\` — \`progress.md\` 中较早的段落（按段落标题日期分月）
- \`handoffs/YYYY-MM.md\` — \`session-handoff.md\` 中较早的轮次（按段落标题日期分月）

归档只搬移、不删改内容；需要历史细节（某个已完成 feature 的方案 / 边界 / 验证记录）时按月查这里。
`;
  if (!DRY_RUN) {
    fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return true;
}

function reportMoved(label, result) {
  if (!result) {
    console.log(`${label}: 文件不存在，跳过`);
    return;
  }
  if (result.moved.length === 0) {
    console.log(`${label}: 无需归档（保留 ${result.kept} 段/条）`);
    return;
  }
  for (const item of result.moved) {
    console.log(`${label}: 归档 ${item.count} 条 → ${item.target}`);
  }
  console.log(`${label}: 活文件保留 ${result.kept} 段/条`);
}

const featureResult = archiveFeatureList();
const progressResult = archiveMarkdownFile('progress.md', 'progress', 'Progress 归档', PROGRESS_HEADER, true);
const handoffResult = archiveMarkdownFile('session-handoff.md', 'handoffs', 'Session Handoff 归档', HANDOFF_HEADER, false);
const readmeCreated = ensureArchiveReadme();

if (DRY_RUN) console.log('[dry-run] 以下为预览，未写入任何文件：');
reportMoved('feature_list', featureResult);
reportMoved('progress    ', progressResult);
reportMoved('handoff    ', handoffResult);
if (readmeCreated && !DRY_RUN) console.log('docs/archive/README.md: 已创建');
