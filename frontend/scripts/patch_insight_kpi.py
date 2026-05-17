import re
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/components/insight/InsightBodies.tsx"
t = p.read_text(encoding="utf-8")

replacement = """export function KpiStrip(props: KpiNumbers) {
  return (
    <UnifiedKpiStrip
      items={[
        { label: 'Total', value: props.total, color: '#6366f1' },
        { label: 'In progress', value: props.inProgress, color: '#a855f7' },
        { label: 'Completed', value: props.completed, color: '#22c55e' },
        { label: 'Overdue', value: props.overdue, color: '#ef4444' },
      ]}
    />
  )
}"""

t2, n = re.subn(
    r"export function KpiStrip\(props: KpiNumbers\) \{[\s\S]*?\n\}\n\nexport function TaskSampleTable",
    replacement + "\n\nexport function TaskSampleTable",
    t,
    count=1,
)
if n != 1:
    raise SystemExit(f"replace failed: {n}")
p.write_text(t2, encoding="utf-8")
print("ok")
