export type TaskLite = {
  id: string
  title?: string | null
  status: string
  priority?: string | null
  due_date?: string | null
  category_id?: string | null
  category_name?: string | null
  assigned_to_name?: string | null
}
