from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/pages/app/MyTasksPage.tsx"
t = p.read_text(encoding="utf-8")
old = """        <div className="myTasksStatCard" style={{ '--kpi-color': '#06b6d4' } as any}><Clock3 size={17} /><motionless><span>To do</span><strong>{taskStats.pending}</strong></div></div>
        <div className="myTasksStatCard" style={{ '--kpi-color': '#a855f7' } as any}><Activity size={17} /><div><span>In progress</span><strong>{taskStats.in_progress}</strong></div></div>
        <div className="myTasksStatCard" style={{ '--kpi-color': '#06b6d4' } as any}><Sparkles size={17} /><div><span>Review</span><strong>{taskStats.submitted}</strong></div></div>
        <div className="myTasksStatCard" style={{ '--kpi-color': '#22c55e' } as any}><CheckCircle2 size={17} /><div><span>Done</span><strong>{taskStats.done}</strong></div></div>"""
old = old.replace("motionless", "div")
new = """        <KpiCard label="To do" value={taskStats.pending} color="#06b6d4" icon={<Clock3 size={28} />} className="myTasksStatCard" />
        <KpiCard label="In progress" value={taskStats.in_progress} color="#a855f7" icon={<Activity size={28} />} className="myTasksStatCard" />
        <KpiCard label="Review" value={taskStats.submitted} color="#06b6d4" icon={<Sparkles size={28} />} className="myTasksStatCard" />
        <KpiCard label="Done" value={taskStats.done} color="#22c55e" icon={<CheckCircle2 size={28} />} className="myTasksStatCard" />"""
if old not in t:
    raise SystemExit("block not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("ok")
