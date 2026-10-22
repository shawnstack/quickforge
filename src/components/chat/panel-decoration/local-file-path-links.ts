/**
 * Local file path detection (pure).
 *
 * The decoration layer used to walk rendered Markdown with a TreeWalker and
 * replace matching text nodes with buttons. That meant the link only appeared
 * after a decorate pass, and every re-render had to re-run the walk (guarded by
 * a signature stamped on the message element). The surface now splits the path
 * candidates during Markdown parsing (see `rehypeQfLocalFilePaths`) and renders
 * them as React nodes, so this module only holds the detection rules.
 *
 * 三条备选分支（绝对路径优先，避免相对分支在绝对路径内部产生子串匹配）：
 * 1. Windows 盘符绝对路径：`D:\x\y.md` / `D:/x/y.md`；
 * 2. Unix 常见家目录/挂载点前缀的绝对路径；
 * 3. 工作区相对路径：≥2 段、`/` 或 `\` 分隔（可混用）：
 *    首段 [A-Za-z0-9_-]+（不含点，排除 example.com / v1.2 这类形态），
 *    中间段 [A-Za-z0-9_.-]+，末段必须带扩展名（basename 允许多个点，如 chat.test.ts、
 *    patch-release-runbook.zh-CN.md），扩展名 1-8 位字母数字，尾部负向前瞻
 *    (?![A-Za-z0-9]) 防止紧跟的英文单词并进扩展名（foo.tsxand 整体不匹配，保持原文）。
 * 整体前置的行后行断言 (?<![\w./\\:-]) 对三条分支统一生效，排除前面紧跟
 * 单词字符/点/分隔符/冒号的起点：防 URL 子串（https://example.com/a.ts 的 s:// 与
 * example.com/a.ts 两处）、盘符/Unix 路径内部重复匹配（D:\x\src）与版本号（v1.2/file）误伤。
 * 分支 1/2 的尾部字符类故意宽松（只排空白/引号/尖括号/反引号）以保住含 CJK 段的合法路径
 * （D:\文档\说明.md），代价是会把路径后紧贴的正文一起吞进匹配——真正的路径终点由
 * resolveLocalFilePathCandidate 在解析阶段截断（见其注释）。
 */
export const LOCAL_FILE_PATH_REGEX =
  /(?<![\w./\\:-])(?:[A-Za-z]:[\\/][^\s"'<>`]+|(?:\/Users|\/home|\/workspace|\/mnt|\/Volumes)\/[^\s"'<>`]+|[A-Za-z0-9_-]+(?:[\\/][A-Za-z0-9_.-]+)*[\\/][A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9]))/g

const TRAILING_PATH_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '。', '，', '；', '：', '！', '？', '）', '】', '》'])
// CJK 标点/假名/表意/扩展/兼容/谚文/全角字符：绝对路径分支的宽松尾部字符类会把这些连同
// 后面的正文一起吞进匹配，解析阶段把它们当作路径终点候选。
const CJK_TEXT_REGEX = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff00-\uffef]/
// 有效路径终点：候选以 1-8 位字母数字扩展名结尾（`...\index.css`）。
const PATH_EXTENSION_TAIL_REGEX = /\.[A-Za-z0-9]{1,8}$/

function trimTrailingPathPunctuation(value: string) {
  let end = value.length
  while (end > 0 && TRAILING_PATH_PUNCTUATION.has(value[end - 1])) end -= 1
  return { path: value.slice(0, end), suffix: value.slice(end) }
}

/**
 * 正则只负责召回，真正要链接的路径终点由这里解析（按序）：
 * 1. 剥掉末尾标点（中英文均含）；
 * 2. 候选无 CJK 字符 → 直接接受（`D:\repo\dist 后面` 这类无扩展名目录路径不受影响）；
 * 3. 候选本身以扩展名结尾 → 接受整串（含 CJK 段的合法路径，如 `D:\文档\说明.md`）；
 * 4. 从左到右找 CJK 位置截断，取第一个使剩余部分以扩展名结尾的位置：
 *    `D:\repo\index.css后面还有文字` → `D:\repo\index.css`，剩余文字回到正文；
 * 5. 找不到有效截断（如 `D:\logs\debug后面`，无扩展名定位不了终点）→ 返回 null 放弃链接，
 *    宁可不链接也不把正文吞进路径。
 */
export function resolveLocalFilePathCandidate(rawMatch: string): { path: string; suffix: string } | null {
  const { path: trimmed, suffix } = trimTrailingPathPunctuation(rawMatch)
  if (!trimmed) return null
  if (!CJK_TEXT_REGEX.test(trimmed) || PATH_EXTENSION_TAIL_REGEX.test(trimmed)) {
    return { path: trimmed, suffix }
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (!CJK_TEXT_REGEX.test(trimmed.charAt(index))) continue
    const candidate = trimmed.slice(0, index)
    if (candidate && PATH_EXTENSION_TAIL_REGEX.test(candidate)) {
      return { path: candidate, suffix: trimmed.slice(index) + suffix }
    }
  }
  return null
}

export type LocalFilePathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'path'; path: string }

/**
 * Split a plain text run into literal text and path segments.
 *
 * The regex carries `lastIndex` state, so it is reset per call: a leftover
 * position from a previous call used to make one node skip its match.
 */
export function splitLocalFilePaths(text: string): LocalFilePathSegment[] {
  LOCAL_FILE_PATH_REGEX.lastIndex = 0
  if (!LOCAL_FILE_PATH_REGEX.test(text)) {
    LOCAL_FILE_PATH_REGEX.lastIndex = 0
    return [{ kind: 'text', value: text }]
  }
  LOCAL_FILE_PATH_REGEX.lastIndex = 0

  const segments: LocalFilePathSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LOCAL_FILE_PATH_REGEX.exec(text))) {
    const resolved = resolveLocalFilePathCandidate(match[0])
    if (!resolved) continue
    const start = match.index
    if (start > lastIndex) segments.push({ kind: 'text', value: text.slice(lastIndex, start) })
    segments.push({ kind: 'path', path: resolved.path })
    if (resolved.suffix) segments.push({ kind: 'text', value: resolved.suffix })
    lastIndex = start + match[0].length
  }
  LOCAL_FILE_PATH_REGEX.lastIndex = 0
  if (segments.length === 0) return [{ kind: 'text', value: text }]
  if (lastIndex < text.length) segments.push({ kind: 'text', value: text.slice(lastIndex) })
  return segments
}
