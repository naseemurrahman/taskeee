import re
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/pages/app/InsightsPage.tsx"
t = p.read_text(encoding="utf-8")
t2, n = re.subn(
    r"\nfunction StatCard\(\{[\s\S]*?\n\}\n\nfunction ChartCard",
    "\n\nfunction ChartCard",
    t,
    count=1,
)
if n != 1:
    raise SystemExit(f"failed {n}")
p.write_text(t2, encoding="utf-8")
print("ok")
