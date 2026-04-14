import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Lang = 'en' | 'ar'
export const LANG_KEY = 'tf_lang'

function readLang(): Lang {
  const v = String(localStorage.getItem(LANG_KEY) || 'en').toLowerCase()
  return v === 'ar' ? 'ar' : 'en'
}

type Dict = Record<string, { en: string; ar: string }>

const DICT: Dict = {
  // global
  'lang.en': { en: 'English', ar: 'الإنجليزية' },
  'lang.ar': { en: 'Arabic', ar: 'العربية' },
  'common.loading': { en: 'Loading…', ar: 'جارٍ التحميل…' },
  'common.searchPlaceholder': { en: 'Search tasks, people, reports…', ar: 'ابحث عن المهام، الأشخاص، التقارير…' },
  'common.signOut': { en: 'Sign out', ar: 'تسجيل الخروج' },
  'common.open': { en: 'Open', ar: 'فتح' },
  'common.viewAll': { en: 'View all', ar: 'عرض الكل' },

  // marketing nav/actions
  'mkt.products': { en: 'Products', ar: 'المنتجات' },
  'mkt.solutions': { en: 'Solutions', ar: 'الحلول' },
  'mkt.resources': { en: 'Resources', ar: 'الموارد' },
  'mkt.pricing': { en: 'Pricing', ar: 'الأسعار' },
  'mkt.signIn': { en: 'Sign in', ar: 'تسجيل الدخول' },
  'mkt.signUp': { en: 'Sign up', ar: 'إنشاء حساب' },

  // app sections
  'nav.general': { en: 'General', ar: 'عام' },
  'nav.team': { en: 'Team', ar: 'الفريق' },
  'nav.peopleOps': { en: 'People Ops', ar: 'شؤون الموظفين' },
  'nav.sales': { en: 'Sales', ar: 'المبيعات' },
  'nav.integrations': { en: 'Integrations', ar: 'التكاملات' },
  'nav.admin': { en: 'Admin', ar: 'الإدارة' },
  'nav.language': { en: 'Language', ar: 'اللغة' },
  'nav.theme': { en: 'Theme', ar: 'المظهر' },
  'theme.dark': { en: 'Dark', ar: 'داكن' },
  'theme.light': { en: 'Light', ar: 'فاتح' },

  'dashboard.greeting.morning': { en: 'Good morning', ar: 'صباح الخير' },
  'dashboard.greeting.afternoon': { en: 'Good afternoon', ar: 'مساء الخير' },
  'dashboard.greeting.evening': { en: 'Good evening', ar: 'مساء الخير' },
  'dashboard.subtitle': { en: 'Here’s what’s going on today.', ar: 'هذا ما يحدث اليوم.' },
  'dashboard.jeczone': { en: 'Jeczone', ar: 'جكزون' },
  'dashboard.totalTasks': { en: 'Total tasks', ar: 'إجمالي المهام' },
  'dashboard.inProgress': { en: 'In progress', ar: 'جارٍ التنفيذ' },
  'dashboard.completed': { en: 'Completed', ar: 'مكتملة' },
  'dashboard.overdue': { en: 'Overdue', ar: 'متأخرة' },
  'dashboard.completion': { en: 'Completion', ar: 'الاكتمال' },
  'dashboard.teamScore': { en: 'Team score', ar: 'درجة الفريق' },
  'dashboard.teamCapacity': { en: 'Team capacity', ar: 'سعة الفريق' },
  'dashboard.teamCapacitySubtitle': { en: 'Track assignment balance and workload pressure across active members.', ar: 'تتبع توازن التعيينات وضغط العمل عبر الأعضاء النشطين.' },
  'dashboard.balanced': { en: 'Balanced', ar: 'متوازن' },
  'dashboard.overloaded': { en: 'Overloaded', ar: 'محمل بزيادة' },
  'dashboard.underutilized': { en: 'Underutilized', ar: 'غير مستغل بالكامل' },
  'dashboard.avgOpenTasks': { en: 'Avg open tasks', ar: 'متوسط المهام المفتوحة' },
  'dashboard.summaryUnavailableHeading': { en: 'Team summary unavailable', ar: 'ملخص الفريق غير متوفر' },
  'dashboard.summaryUnavailableBody': { en: 'Your role may not include org-wide metrics, or the service was unreachable. KPI tiles may show “—”; charts still use tasks loaded for your account.', ar: 'قد لا يتضمن دورك مقاييس على مستوى المنظمة، أو قد لا يكون الخادم متاحًا. قد تعرض بطاقات KPI "-"؛ لا تزال الرسوم البيانية تستخدم المهام المحملة لحسابك.' },
  'dashboard.dueToday': { en: 'Due today', ar: 'مستحق اليوم' },
  'dashboard.calendar': { en: 'Calendar', ar: 'التقويم' },
  'dashboard.myOpenTasks': { en: 'My open tasks', ar: 'مهامي المفتوحة' },
  'dashboard.openList': { en: 'Open list', ar: 'افتح القائمة' },
  'dashboard.noDueTodayTitle': { en: 'You’re clear for today', ar: 'ليس لديك شيء اليوم' },
  'dashboard.noDueTodayBody': { en: 'No dated tasks due today. Plan ahead on the calendar or board.', ar: 'لا توجد مهام مؤرخة مستحقة اليوم. خطط مسبقًا على التقويم أو اللوحة.' },
  'dashboard.noAssignmentsTitle': { en: 'No assignments in this view', ar: 'لا توجد تعيينات في هذا العرض' },
  'dashboard.noAssignmentsBody': { en: 'Tasks assigned to you appear here. Managers can create and assign work from Tasks or Board.', ar: 'المهام المخصصة لك تظهر هنا. يمكن للمديرين إنشاء وتعيين العمل من المهام أو اللوحة.' },
  'dashboard.employeePerformance': { en: 'Employee performance', ar: 'أداء الموظفين' },
  'dashboard.projectsStatistics': { en: 'Projects statistics', ar: 'إحصاءات المشاريع' },
  'dashboard.taskAssignments': { en: 'Task assignments', ar: 'تعيينات المهام' },
  'dashboard.deadlines': { en: 'Deadlines', ar: 'المواعيد النهائية' },
  'dashboard.statusOverview': { en: 'Status overview', ar: 'نظرة عامة على الحالة' },
  'dashboard.priorityMix': { en: 'Priority mix', ar: 'مزيج الأولويات' },
  'dashboard.workloadBalance': { en: 'Workload balance', ar: 'توازن العمل' },
  'dashboard.details': { en: 'Details', ar: 'تفاصيل' },
  'dashboard.openTasks': { en: 'Open tasks', ar: 'افتح المهام' },
  'dashboard.analytics': { en: 'Analytics', ar: 'التحليلات' },
  'dashboard.noDataYet': { en: 'No data yet', ar: 'لا توجد بيانات بعد' },
  'dashboard.noTasksLoaded': { en: 'No tasks loaded.', ar: 'لا توجد مهام محملة.' },

  'common.openBoard': { en: 'Open board', ar: 'افتح اللوحة' },
  'common.createTask': { en: 'Create task', ar: 'إنشاء مهمة' },
  'common.taskStatus': { en: 'Status', ar: 'الحالة' },
  'common.quickFilters': { en: 'Quick filters', ar: 'مرشحات سريعة' },
  'common.all': { en: 'All', ar: 'الكل' },
  'common.pending': { en: 'Pending', ar: 'قيد الانتظار' },
  'common.active': { en: 'Active', ar: 'نشط' },
  'common.submitted': { en: 'Submitted', ar: 'مقدم' },
  'common.done': { en: 'Done', ar: 'تمت' },
  'common.overdue': { en: 'Overdue', ar: 'متأخرة' },
  'common.filterDescription': { en: 'Filter and review task assignments.', ar: 'قم بتصفية ومراجعة تعيينات المهام.' },
  'common.failedLoadTasks': { en: 'Failed to load tasks.', ar: 'فشل تحميل المهام.' },
  'common.noTasksYetCreate': { en: 'No tasks yet. Create the first task to populate analytics and dashboards.', ar: 'لا توجد مهام بعد. أنشئ المهمة الأولى لملء التحليلات ولوحة التحكم.' },
  'common.noTasksYetAsk': { en: 'No tasks yet. Ask your manager to assign your first task.', ar: 'لا توجد مهام بعد. اطلب من مديرك تعيين المهمة الأولى.' },
  'common.aiSummary': { en: 'AI summary (30 days)', ar: 'ملخص الذكاء الاصطناعي (30 يومًا)' },
  'common.openInsights': { en: 'Open insights', ar: 'افتح الرؤى' },
  'common.sending': { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  'common.aiReview': { en: 'AI review', ar: 'مراجعة الذكاء الاصطناعي' },
  'common.noRowsForSlice': { en: 'No rows for this slice.', ar: 'لا توجد صفوف لهذا الجزء.' },
  'common.noUpcomingDatedTasks': { en: 'No upcoming dated tasks.', ar: 'لا توجد مهام مؤرخة قادمة.' },

  'search.typeAtLeastTwo': { en: 'Type at least 2 characters.', ar: 'اكتب ما لا يقل عن حرفين.' },
  'search.searching': { en: 'Searching…', ar: 'جارٍ البحث…' },
  'search.noResults': { en: 'No results.', ar: 'لا توجد نتائج.' },
  'search.group.tasks': { en: 'Tasks', ar: 'المهام' },
  'search.group.people': { en: 'People', ar: 'الأشخاص' },
  'search.group.reports': { en: 'Reports', ar: 'التقارير' },
  'search.group.notifications': { en: 'Notifications', ar: 'الإشعارات' },
  'search.group.projects': { en: 'Projects', ar: 'المشاريع' },
  'search.report': { en: 'Report', ar: 'تقرير' },
  'search.notification': { en: 'Notification', ar: 'إشعار' },
  'search.openProjects': { en: 'Open projects', ar: 'افتح المشاريع' },

  // nav items
  'nav.dashboard': { en: 'Dashboard', ar: 'لوحة التحكم' },
  'nav.tasks': { en: 'Tasks', ar: 'المهام' },
  'nav.myTasks': { en: 'My tasks', ar: 'مهامي' },
  'nav.board': { en: 'Board', ar: 'لوحة كانبان' },
  'nav.projects': { en: 'Projects', ar: 'المشاريع' },
  'nav.calendar': { en: 'Calendar', ar: 'التقويم' },
  'nav.analytics': { en: 'Analytics', ar: 'التحليلات' },
  'nav.billing': { en: 'Billing', ar: 'الفوترة' },
  'nav.contractors': { en: 'Contractors', ar: 'المتعاقدون' },
  'nav.jeczone': { en: 'Jeczone', ar: 'جكزون' },
  'nav.profile': { en: 'Profile', ar: 'الملف الشخصي' },
  'nav.directory': { en: 'Directory', ar: 'الدليل' },
  'nav.reports': { en: 'Reports', ar: 'التقارير' },
  'nav.audit': { en: 'Audit', ar: 'التدقيق' },
  'nav.employees': { en: 'Employees', ar: 'الموظفون' },
  'nav.timeOff': { en: 'Time off', ar: 'الإجازات' },
  'nav.pipeline': { en: 'Pipeline', ar: 'مسار المبيعات' },
  'nav.leads': { en: 'Leads', ar: 'العملاء المحتملون' },
  'nav.connections': { en: 'Connections', ar: 'الاتصالات' },
  'nav.insights': { en: 'Insights', ar: 'الرؤى' },
  'nav.logs': { en: 'Logs', ar: 'السجلات' },

  // titles
  'title.dashboard': { en: 'Dashboard', ar: 'لوحة التحكم' },
  'title.tasks': { en: 'Tasks', ar: 'المهام' },
  'title.myTasks': { en: 'My tasks', ar: 'مهامي' },
  'title.analytics': { en: 'Analytics', ar: 'التحليلات' },
  'title.profile': { en: 'Profile', ar: 'الملف الشخصي' },
  'title.logs': { en: 'Logs', ar: 'السجلات' },
}

type I18nCtx = {
  lang: Lang
  setLang: (next: Lang) => void
  t: (key: string) => string
}

const Ctx = createContext<I18nCtx | null>(null)

export function I18nProvider(props: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readLang())

  function setLang(next: Lang) {
    setLangState(next)
    localStorage.setItem(LANG_KEY, next)
  }

  const t = useMemo(() => {
    return (key: string) => {
      const row = DICT[key]
      if (!row) return key
      return lang === 'ar' ? row.ar : row.en
    }
  }, [lang])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const value = useMemo<I18nCtx>(() => ({ lang, setLang, t }), [lang, t])
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useI18n() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

