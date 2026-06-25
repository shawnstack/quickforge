/**
 * 基于最长公共子序列（LCS）按行计算两段文本的增删行数，
 * 行级口径与 `git diff --numstat` 一致。
 *
 * 返回 undefined 表示文件过大、为避免阻塞 UI 而跳过计算。
 */
export function countDiffLines(
  oldContent: string,
  newContent: string,
): { added: number; removed: number } | undefined {
  const a = oldContent.replace(/\r\n?/g, '\n').split('\n')
  const b = newContent.replace(/\r\n?/g, '\n').split('\n')
  const m = a.length
  const n = b.length

  // O(m*n) 复杂度，超过阈值则放弃，避免拖慢界面
  if (m * n > 4_000_000) return undefined

  // 滚动数组，空间 O(n)
  let prev = new Array<number>(n + 1).fill(0)
  let curr = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    const ai = a[i - 1]
    for (let j = 1; j <= n; j++) {
      curr[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }

  const common = prev[n]
  return { added: n - common, removed: m - common }
}
