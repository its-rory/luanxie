/* 轻量行级 diff(LCS),用于版本对比。 */
function diffLines(oldText: string, newText: string) {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const m = a.length, n = b.length
  // LCS 表(笔记规模内够用;超长时退化为整体展示)
  if (m * n > 400_000) return [{ type: 'del', lines: a }, { type: 'add', lines: b }]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { type: 'same' | 'add' | 'del'; lines: string[] }[] = []
  const push = (type: 'same' | 'add' | 'del', line: string) => {
    const last = out[out.length - 1]
    if (last && last.type === type) last.lines.push(line)
    else out.push({ type, lines: [line] })
  }
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++ }
    else { push('add', b[j]); j++ }
  }
  while (i < m) { push('del', a[i]); i++ }
  while (j < n) { push('add', b[j]); j++ }
  return out
}

export default function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const hunks = diffLines(oldText, newText)
  return (
    <div className="diff-view">
      {hunks.map((h, idx) => {
        if (h.type === 'same') {
          // 上下文压缩:只展示改动附近的两行
          const ctx = h.lines.length > 5
            ? [...h.lines.slice(0, 2), `… ${h.lines.length - 4} 行未变 …`, ...h.lines.slice(-2)]
            : h.lines
          return (
            <div key={idx}>
              {ctx.map((l, k) => <span key={k} style={{ display: 'block', opacity: 0.55 }}>{l || ' '}</span>)}
            </div>
          )
        }
        return (
          <div key={idx}>
            {h.lines.map((l, k) => (
              <span key={k} className={h.type} style={{ display: 'block' }}>{h.type === 'add' ? '+ ' : '- '}{l || ' '}</span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
