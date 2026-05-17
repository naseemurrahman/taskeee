import re
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/pages/app/ReportDetailPage.tsx"
t = p.read_text(encoding="utf-8")
if "KpiStrip" not in t.split("ReportDetailPage")[0]:
    t = t.replace(
        "import { apiFetch } from '../../lib/api'\n",
        "import { apiFetch } from '../../lib/api'\nimport { KpiStrip } from '../../components/ui/KpiCard'\n",
        1,
    )

replacement = """                <KpiStrip
                  className="reportStatGrid"
                  items={[
                    { label: 'Tasks in period', value: payload.summary.total ?? 0, color: '#6366f1' },
                    { label: 'Completed', value: payload.summary.completed ?? 0, color: '#22c55e' },
                    { label: 'Open overdue', value: payload.summary.overdueTasks ?? 0, color: '#ef4444' },
                    { label: 'Completion rate', value: `${payload.summary.completionRate ?? 0}%`, color: 'var(--primary)', animate: false },
                  ]}
                />"""

t2, n = re.subn(
    r"<div className=\"reportStatGrid\">[\s\S]*?</motionless>\s*</div>\s*\n\s*</motionless>\s*\n\s*\) : null",
    replacement + "\n              </div>\n            ) : null",
    t,
    count=1,
)
# fix pattern - closing is </motionless> wrong
t2, n = re.subn(
    r"<div className=\"reportStatGrid\">[\s\S]*?</div>\s*\n\s*</div>\s*\n\s*\) : null",
    replacement + "\n              </div>\n            ) : null",
    t,
    count=1,
)
if n != 1:
    raise SystemExit(f"failed {n}")
p.write_text(t2, encoding="utf-8")
print("ok")
