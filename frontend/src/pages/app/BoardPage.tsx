import { useMemo, useState, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useRealtimeInvalidation } from '../../lib/socket'
import { getUser } from '../../state/auth'
import { canCreateTasksAndProjects, canChangeTaskStatus, isEmployeeRole } from '../../lib/rbac'
import { CreateTaskModal } from '../../components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '../../components/tasks/TaskDetailDrawer'
import { buildTaskSignal, signalBadgeClass } from '../../utils/taskSignals'
import { useToast } from '../../components/ui/ToastSystem'

type Task = {
  id: string; title: string; status: string; priority?: string | null
  category_name?: string | null; category_color?: string | null
  assigned_to?: string | null; assigned_to_name?: string | null
  due_date?: string | null; message_count?: number
}
type WorkloadRow = { employee_id: string; employee_name?: string; open_tasks: number }

const COLUMNS = [
  { key: 'pending',          label: 'To Do',       color: '#f59e0b', emoji: '○', bg: 'rgba(245,158,11,0.06)'  },
  { key: 'in_progress',      label: 'In Progress', color: '#8B5CF6', emoji: '◑', bg: 'rgba(139,92,246,0.06)'  },
  { key: 'submitted',        label: 'Submitted',   color: '#38bdf8', emoji: '◉', bg: 'rgba(56,189,248,0.06)'  },
  { key: 'manager_approved', label: 'Approved',    color: '#22c55e', emoji: '✓', bg: 'rgba(34,197,94,0.06)'   },
  { key: 'completed',        label: 'Done',        color: '#22c55e', emoji: '●', bg: 'rgba(34,197,94,0.06)'   },
  { key: 'overdue',          label: 'Overdue',     color: '#ef4444', emoji: '⚠', bg: 'rgba(239,68,68,0.06)'   },
]
const PRIORITY_COLOR: Record<string, string> = { low:'#38bdf8', medium:'#8B5CF6', high:'#f97316', critical:'#ef4444', urgent:'#ef4444' }

async function fetchTasks(isEmployee: boolean) {
  const d = await apiFetch<{ tasks?: Task[]; rows?: Task[] }>(`/api/v1/tasks?limit=300&page=1${isEmployee ? '&mine=true' : ''}`)
  return (d.tasks || d.rows || []) as Task[]
}
async function fetchWorkload() {
  try { const d = await apiFetch<{ employees: WorkloadRow[] }>('/api/v1/analytics/workload?days=30'); return d.employees || [] } catch { return [] }
}
async function patchStatus(taskId: string, status: string) {
  return apiFetch(`/api/v1/tasks/${taskId}/set-status`, { method: 'POST', json: { status } })
}
function hashColor(s: string) { let h=0; for (const c of s) h=(h<<5)-h+c.charCodeAt(0); return `hsl(${Math.abs(h)%360},55%,55%)` }
function Initials({ name, size=20 }: { name:string; size?:number }) {
  const abbr = name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase(); const color = hashColor(name)
  return <div style={{ width:size,height:size,borderRadius:size/3,background:color+'28',color,border:`1px solid ${color}40`,display:'grid',placeItems:'center',fontSize:size*0.38,fontWeight:800,flexShrink:0 }}>{abbr}</div>
}
function DueLabel({ iso }: { iso?: string|null }) {
  if (!iso) return null
  const numeric = Number(iso)
  const d = (!isNaN(numeric) && numeric > 1_000_000_000) ? new Date(numeric * 1000) : new Date(iso)
  if (isNaN(d.getTime())) return null
  const yr = d.getFullYear(); if (yr < 2020 || yr > 2040) return null
  const today=new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0)
  const days=Math.round((d.getTime()-today.getTime())/86400000)
  const color=days<0?'#ef4444':days<=1?'#f59e0b':'#9ca3af'
  const label=days<0?`${Math.abs(days)}d overdue`:days===0?'Today':days===1?'Tomorrow':new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'})
  return <span style={{fontSize:10,fontWeight:750,color,display:'inline-flex',alignItems:'center',gap:3}}>📅 {label}</span>
}
function loadTone(load:number,avg:number) {
  if (load<=Math.max(1,avg*0.65)) return {label:'Available',color:'#22c55e',bg:'rgba(34,197,94,0.12)'}
  if (load<=Math.max(3,avg*1.15)) return {label:'Balanced',color:'#8B5CF6',bg:'rgba(139,92,246,0.12)'}
  return {label:'High load',color:'#f97316',bg:'rgba(249,115,22,0.12)'}
}

export function BoardPage() {
  const { success: toastSuccess, error: toastError } = useToast()
  const me = getUser(); const canManage = canCreateTasksAndProjects(me?.role)
  const canDrag = canChangeTaskStatus(me?.role); const isEmployee = isEmployeeRole(me?.role)
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  useRealtimeInvalidation({ tasks: true, board: true, dashboard: true })
  const [selectedTaskId, setSelectedTaskId] = useState<string|null>(null)
  const [boardError, setBoardError] = useState<string|null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [aiSort, setAiSort] = useState(true)
  const [draggedTaskId, setDraggedTaskId] = useState<string|null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string|null>(null)
  const [movingTaskIds, setMovingTaskIds] = useState<Set<string>>(new Set())
  const dragCounter = useRef<Record<string,number>>({})

  const tasksQ = useQuery({ queryKey:['tasks','board'], queryFn:()=>fetchTasks(isEmployee), staleTime:30_000, refetchInterval:60_000 })
  const workloadQ = useQuery({ queryKey:['analytics-workload','board'], queryFn:fetchWorkload, staleTime:45_000 })
  const tasks = tasksQ.data||[]; const workloadRows = workloadQ.data||[]
  const loadByUser = useMemo(()=>new Map(workloadRows.map(w=>[w.employee_id,Number(w.open_tasks||0)])),[workloadRows])
  const avgLoad = workloadRows.length ? workloadRows.reduce((s,w)=>s+Number(w.open_tasks||0),0)/workloadRows.length : 0

  const statusMutation = useMutation({
    mutationFn:({id,status}:{id:string;status:string})=>patchStatus(id,status),
    onMutate:({id:mutId})=>{ setMovingTaskIds(prev=>new Set([...prev,mutId])) },
    onSuccess:(_data,{status})=>{
      const label=COLUMNS.find(c=>c.key===status)?.label||status
      toastSuccess('Status updated',`Task moved to ${label}`)
      qc.invalidateQueries({queryKey:['tasks']}); qc.invalidateQueries({queryKey:['dashboard']})
    },
    onError:(err:any,{id:_eid})=>{
      const msg=err?.message||'Status update failed'
      toastError('Update failed',msg); setBoardError(msg); setTimeout(()=>setBoardError(null),6000)
      qc.invalidateQueries({queryKey:['tasks','board']})
    },
    onSettled:(_,__,{id})=>{ setMovingTaskIds(prev=>{const n=new Set(prev);n.delete(id);return n}) },
  })

  const intelligence = useMemo(()=>{
    const scored=tasks.map(task=>({task,signal:buildTaskSignal(task,loadByUser)}))
    const risky=scored.filter(item=>item.signal.needsAttention)
    const topRisk=scored.slice().sort((a,b)=>b.signal.score-a.signal.score).slice(0,3)
    const overloaded=workloadRows.slice().sort((a,b)=>Number(b.open_tasks||0)-Number(a.open_tasks||0)).slice(0,4)
    const available=workloadRows.slice().sort((a,b)=>Number(a.open_tasks||0)-Number(b.open_tasks||0)).slice(0,4)
    const suggestions=topRisk.filter(item=>item.task.assigned_to&&item.signal.score>=55).slice(0,3).map((item,i)=>{
      const targets=available.filter(c=>c.employee_id!==item.task.assigned_to); const target=targets[i%Math.max(targets.length,1)]
      return {task:item.task.title,from:item.task.assigned_to_name||'current owner',to:target?.employee_name||'another teammate',score:item.signal.score,reason:item.signal.loadNote||item.signal.note}
    })
    return {scored,risky,topRisk,overloaded,available,suggestions}
  },[tasks,loadByUser,workloadRows])

  const visibleTasks = useMemo(()=>{
    let rows=intelligence.scored
    if (focusMode) rows=rows.filter(item=>item.signal.needsAttention)
    if (aiSort) rows=rows.slice().sort((a,b)=>b.signal.score-a.signal.score)
    return rows.map(item=>item.task)
  },[aiSort,focusMode,intelligence.scored])

  const byCol = useMemo(()=>{
    const map:Record<string,Task[]>={}
    for (const col of COLUMNS) map[col.key]=[]
    for (const task of visibleTasks) { const k=COLUMNS.find(c=>c.key===task.status)?.key||'pending'; map[k].push(task) }
    return map
  },[visibleTasks])

  const handleDragStart = useCallback((e:React.DragEvent,taskId:string)=>{
    if (!canDrag) return
    e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('taskId',taskId); setDraggedTaskId(taskId)
  },[canDrag])
  const handleDragEnd = useCallback(()=>{ setDraggedTaskId(null); setDragOverColumn(null); dragCounter.current={} },[])
  const handleColumnDragOver = useCallback((e:React.DragEvent,colKey:string)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; if (dragOverColumn!==colKey) setDragOverColumn(colKey) },[dragOverColumn])
  const handleColumnDragEnter = useCallback((e:React.DragEvent,colKey:string)=>{ e.preventDefault(); dragCounter.current[colKey]=(dragCounter.current[colKey]||0)+1; setDragOverColumn(colKey) },[])
  const handleColumnDragLeave = useCallback((_e:React.DragEvent,colKey:string)=>{ dragCounter.current[colKey]=Math.max(0,(dragCounter.current[colKey]||1)-1); if (dragCounter.current[colKey]===0) setDragOverColumn(prev=>prev===colKey?null:prev) },[])
  const handleDrop = useCallback((e:React.DragEvent,targetStatus:string)=>{
    e.preventDefault(); const taskId=e.dataTransfer.getData('taskId'); const task=tasks.find(t=>t.id===taskId)
    if (!taskId||!task) return
    if (task.status!==targetStatus) statusMutation.mutate({id:taskId,status:targetStatus})
    setDragOverColumn(null)
  },[tasks,statusMutation])

  const signalFor=(task:Task)=>buildTaskSignal(task,loadByUser)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      {/* Page header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle" style={{display:'flex',alignItems:'center',gap:10}}>
              Intelligent Board
              {canDrag && <span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:999,background:'rgba(139,92,246,0.15)',color:'#8B5CF6',border:'1px solid rgba(139,92,246,0.3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>Drag & Drop</span>}
            </div>
            <div className="pageHeaderCardSub">Drag cards between columns. AI scoring, Focus Mode, and workload heatmap included.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{tasks.length} tasks</span>
              {focusMode && <span className="pageHeaderCardTag" style={{color:'#f97316',background:'rgba(249,115,22,0.10)',borderColor:'rgba(249,115,22,0.24)'}}>Focus: {visibleTasks.length}</span>}
              {intelligence.risky.length>0 && <span className="pageHeaderCardTag" style={{color:'#f97316',background:'rgba(249,115,22,0.10)',borderColor:'rgba(249,115,22,0.24)'}}>{intelligence.risky.length} need attention</span>}
              {!canDrag && <span className="pageHeaderCardTag" style={{color:'#9ca3af'}}>Read-only view</span>}
            </div>
          </div>
          {canManage && <button className="btn btnPrimary" onClick={()=>setCreateOpen(true)} style={{display:'flex',alignItems:'center',gap:7}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Task
          </button>}
        </div>
      </div>

      {/* AI Intelligence panel */}
      <div className="chartV3" style={{padding:16,display:'grid',gap:14}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button type="button" className={focusMode?'btn btnPrimary':'btn btnGhost'} onClick={()=>setFocusMode(v=>!v)}>Focus Mode</button>
            <button type="button" className={aiSort?'btn btnPrimary':'btn btnGhost'} onClick={()=>setAiSort(v=>!v)}>AI Sort</button>
          </div>
          <div style={{color:'var(--text2)',fontSize:12,fontWeight:700}}>Avg workload: {avgLoad.toFixed(1)} open/person</div>
        </div>
        <div className="grid3">
          {/* Top risk */}
          <div className="miniCard">
            <div className="miniLabel">Highest Risk</div>
            <div style={{display:'grid',gap:8,marginTop:10}}>
              {intelligence.topRisk.length===0 ? <span style={{color:'var(--text2)',fontSize:12}}>No at-risk tasks 🎉</span>
              : intelligence.topRisk.map(item=>(
                <button key={item.task.id} type="button" onClick={()=>setSelectedTaskId(item.task.id)} style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',background:'none',border:'none',cursor:'pointer',padding:0,textAlign:'left'}}>
                  <span style={{fontSize:12,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text)'}}>{item.task.title}</span>
                  <span className={signalBadgeClass(item.signal.level)} style={{flexShrink:0}}>{item.signal.score}%</span>
                </button>
              ))}
            </div>
          </div>
          {/* Workload heatmap */}
          <div className="miniCard">
            <div className="miniLabel">Workload Heatmap</div>
            <div style={{display:'grid',gap:8,marginTop:10}}>
              {intelligence.overloaded.length===0 ? <span style={{color:'var(--text2)',fontSize:12}}>No workload data yet</span>
              : intelligence.overloaded.map(row=>{ const tone=loadTone(Number(row.open_tasks||0),avgLoad); return (
                <div key={row.employee_id} style={{display:'grid',gap:4}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,fontWeight:700}}>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.employee_name||'Team member'}</span>
                    <span style={{color:tone.color,background:tone.bg,padding:'1px 7px',borderRadius:999,fontSize:10,fontWeight:800,flexShrink:0}}>{row.open_tasks} · {tone.label}</span>
                  </div>
                  <div style={{height:5,borderRadius:999,background:'rgba(255,255,255,.08)',overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.min(100,Number(row.open_tasks||0)*10)}%`,background:tone.color,transition:'width 0.6s ease',borderRadius:999}} />
                  </div>
                </div>
              )})}
            </div>
          </div>
          {/* Smart reassignment */}
          <div className="miniCard">
            <div className="miniLabel">Smart Reassignment</div>
            <div style={{display:'grid',gap:10,marginTop:10}}>
              {intelligence.suggestions.length===0 ? <span style={{color:'var(--text2)',fontSize:12}}>No pressure detected ✓</span>
              : intelligence.suggestions.map((s,i)=>(
                <div key={i} style={{fontSize:12,lineHeight:1.5}}>
                  <div style={{fontWeight:700,color:'var(--text)',marginBottom:2}}>{s.task}</div>
                  <div style={{color:'var(--text2)',fontSize:11}}>
                    <span style={{color:'#f97316'}}>{s.from}</span> → <span style={{color:'#22c55e'}}>{s.to}</span>
                  </div>
                  {s.reason && <div style={{color:'var(--muted)',fontSize:11,marginTop:2}}>{s.reason}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {boardError && (
        <div style={{padding:'12px 16px',borderRadius:12,background:'rgba(239,68,68,0.10)',border:'1.5px solid rgba(239,68,68,0.35)',color:'#ef4444',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:8}}>
          ⚠ {boardError}
        </div>
      )}

      {/* Kanban columns */}
      {tasksQ.isLoading ? (
        <div className="p4BoardGrid">{COLUMNS.map(col=><div key={col.key} className="skeleton" style={{height:340,borderRadius:20}} />)}</div>
      ) : (
        <div className="p4BoardGrid">
          {COLUMNS.map(col=>{
            const colTasks=byCol[col.key]||[]; const isDragOver=dragOverColumn===col.key
            return (
              <div key={col.key} className="p4BoardColumn"
                style={{padding:14,minHeight:280,background:isDragOver?col.bg:undefined,borderColor:isDragOver?col.color+'50':undefined,transition:'all 0.15s ease',outline:isDragOver?`2px solid ${col.color}40`:undefined}}
                onDragOver={canDrag?e=>handleColumnDragOver(e,col.key):undefined}
                onDragEnter={canDrag?e=>handleColumnDragEnter(e,col.key):undefined}
                onDragLeave={canDrag?e=>handleColumnDragLeave(e,col.key):undefined}
                onDrop={canDrag?e=>handleDrop(e,col.key):undefined}
              >
                {/* Column header */}
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                  <div style={{width:26,height:26,borderRadius:8,background:col.color+'20',border:`1px solid ${col.color}40`,display:'grid',placeItems:'center',fontSize:12,color:col.color,fontWeight:900}}>{col.emoji}</div>
                  <span style={{fontWeight:800,fontSize:12.5,color:'var(--text)',letterSpacing:'0.01em'}}>{col.label}</span>
                  <span style={{marginLeft:'auto',fontSize:11,fontWeight:800,padding:'2px 9px',borderRadius:999,background:col.color+'18',color:col.color}}>{colTasks.length}</span>
                </div>

                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {colTasks.map(task=>{
                    const signal=signalFor(task); const pColor=PRIORITY_COLOR[task.priority||'']||'transparent'
                    const isMoving=movingTaskIds.has(task.id); const isDragging=draggedTaskId===task.id
                    return (
                      <div key={task.id} className="p4BoardCard"
                        draggable={canDrag&&!isMoving}
                        onDragStart={canDrag?e=>handleDragStart(e,task.id):undefined}
                        onDragEnd={canDrag?handleDragEnd:undefined}
                        onClick={()=>{ if (!isDragging) setSelectedTaskId(task.id) }}
                        style={{padding:'12px 14px',border:'1px solid var(--border)',position:'relative',cursor:canDrag?'grab':'pointer',opacity:isDragging?0.4:isMoving?0.7:1,transform:isDragging?'scale(0.97)':'scale(1)',transition:'opacity 0.2s ease,transform 0.2s ease',userSelect:'none'}}
                      >
                        {task.priority && <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:pColor,borderRadius:'14px 14px 0 0'}} />}
                        {isMoving && <div style={{position:'absolute',top:8,right:8,width:14,height:14,border:'2px solid var(--primary)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.6s linear infinite'}} />}
                        <div style={{display:'flex',gap:8,alignItems:'flex-start',marginBottom:7,paddingTop:task.priority?6:0}}>
                          <div style={{fontWeight:750,fontSize:13,color:'var(--text)',lineHeight:1.4,flex:1}}>{task.title}</div>
                          <span className={signalBadgeClass(signal.level)} style={{flexShrink:0}}>{signal.score}%</span>
                        </div>
                        {signal.needsAttention && <div style={{color:'#f97316',fontSize:11,fontWeight:700,marginBottom:6}}>{signal.note}</div>}
                        {signal.loadNote && <div style={{color:'#ef4444',fontSize:11,fontWeight:700,marginBottom:6}}>⚠ {signal.loadNote}</div>}
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:task.assigned_to_name?8:0}}>
                          {task.category_name && <span style={{fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:999,background:(task.category_color||'#818cf8')+'22',color:task.category_color||'#818cf8',textTransform:'uppercase',letterSpacing:'0.05em',border:`1px solid ${(task.category_color||'#818cf8')}30`}}>{task.category_name}</span>}
                          <DueLabel iso={task.due_date} />
                        </div>
                        {(task.assigned_to_name||(task.message_count||0)>0) && (
                          <div style={{display:'flex',alignItems:'center',gap:7,borderTop:'1px solid var(--border)',paddingTop:8}}>
                            {task.assigned_to_name && <><Initials name={task.assigned_to_name} /><span style={{fontSize:11,fontWeight:600,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{task.assigned_to_name}</span></>}
                            {(task.message_count||0)>0 && <span style={{fontSize:11,color:'var(--muted)',flexShrink:0}}>💬 {task.message_count}</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {colTasks.length===0 && (
                    <div style={{padding:'28px 16px',textAlign:'center',border:`2px dashed ${isDragOver?col.color:col.color+'30'}`,borderRadius:14,background:isDragOver?col.color+'08':'transparent',transition:'all 0.2s ease',color:'var(--muted)',fontSize:11,fontWeight:700}}>
                      {isDragOver?`Drop → ${col.label}`:'No tasks'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canManage && <CreateTaskModal open={createOpen} onClose={()=>setCreateOpen(false)} />}
      <TaskDetailDrawer taskId={selectedTaskId} onClose={()=>setSelectedTaskId(null)} />
    </div>
  )
}
