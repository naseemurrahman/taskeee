// src/screens/TaskListScreen.tsx
import React, { useEffect, useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, TextInput
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchTasks, setFilter } from '../store/taskSlice';
import { COLORS, FONTS } from '../theme';

const STATUS_FILTERS = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'pending' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'AI Review', value: 'ai_reviewing' },
  { label: 'Approved', value: 'ai_approved' },
  { label: 'Rejected', value: 'ai_rejected' },
  { label: 'Overdue', value: 'overdue' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:          { bg: '#F3F4F6', text: '#374151' },
  in_progress:      { bg: '#DBEAFE', text: '#1E40AF' },
  submitted:        { bg: '#FEF3C7', text: '#92400E' },
  ai_reviewing:     { bg: '#EDE9FE', text: '#5B21B6' },
  ai_approved:      { bg: '#D1FAE5', text: '#065F46' },
  ai_rejected:      { bg: '#FEE2E2', text: '#991B1B' },
  manager_approved: { bg: '#D1FAE5', text: '#065F46' },
  manager_rejected: { bg: '#FEE2E2', text: '#991B1B' },
  completed:        { bg: '#D1FAE5', text: '#065F46' },
  overdue:          { bg: '#FEE2E2', text: '#991B1B' },
  cancelled:        { bg: '#F3F4F6', text: '#9CA3AF' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#10B981', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED'
};

function TaskCard({ task, onPress }: any) {
  const statusStyle = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date()
    && !['completed','cancelled'].includes(task.status);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[task.priority] }]} />
        <Text style={styles.cardTitle} numberOfLines={2}>{task.title}</Text>
      </View>

      <View style={styles.cardMeta}>
        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.statusText, { color: statusStyle.text }]}>
            {task.status.replace(/_/g, ' ')}
          </Text>
        </View>
        {task.categoryName && (
          <View style={[styles.categoryBadge, { backgroundColor: task.categoryColor + '22' || '#f3f4f6' }]}>
            <Text style={[styles.categoryText, { color: task.categoryColor || COLORS.textSecondary }]}>
              {task.categoryName}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.assignedText}>Assigned to: {task.assignedToName}</Text>
        {task.dueDate && (
          <Text style={[styles.dueDate, isOverdue && styles.dueDateOverdue]}>
            {isOverdue ? '⚠ ' : ''}Due: {new Date(task.dueDate).toLocaleDateString()}
          </Text>
        )}
      </View>

      {parseInt(task.photoCount) > 0 && (
        <View style={styles.photoIndicator}>
          <Text style={styles.photoCount}>📷 {task.photoCount} photo{task.photoCount > 1 ? 's' : ''}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function TaskListScreen() {
  const navigation = useNavigation<any>();
  const dispatch = useAppDispatch();
  const { tasks, loading, pagination, filters } = useAppSelector(s => s.tasks);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState('');

  const loadTasks = useCallback((page = 1) => {
    dispatch(fetchTasks({ page, status: activeFilter }));
  }, [activeFilter]);

  useEffect(() => { loadTasks(); }, [activeFilter]);

  const filteredTasks = tasks.filter(t =>
    !searchText || t.title.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Tasks</Text>
        <Text style={styles.headerSubtitle}>{pagination.total} total</Text>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search tasks..."
          placeholderTextColor={COLORS.textTertiary}
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>

      {/* Status Filters */}
      <FlatList
        horizontal
        data={STATUS_FILTERS}
        keyExtractor={item => item.label}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === item.value && styles.filterChipActive]}
            onPress={() => setActiveFilter(item.value)}
          >
            <Text style={[styles.filterChipText, activeFilter === item.value && styles.filterChipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Task List */}
      {loading && tasks.length === 0 ? (
        <ActivityIndicator style={styles.loader} color={COLORS.primary} size="large" />
      ) : (
        <FlatList
          data={filteredTasks}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => loadTasks()} tintColor={COLORS.primary} />
          }
          onEndReached={() => {
            if (pagination.page < pagination.pages) loadTasks(pagination.page + 1);
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No tasks found</Text>
              <Text style={styles.emptySubtext}>Tasks assigned to you will appear here</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end'
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: COLORS.text, fontFamily: FONTS.bold },
  headerSubtitle: { fontSize: 13, color: COLORS.textSecondary, fontFamily: FONTS.regular },
  searchContainer: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff' },
  searchInput: {
    height: 40, borderRadius: 10, backgroundColor: COLORS.background,
    paddingHorizontal: 14, fontSize: 14, color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border, fontFamily: FONTS.regular
  },
  filterList: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff' },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: COLORS.background, marginRight: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 13, color: COLORS.textSecondary, fontFamily: FONTS.medium },
  filterChipTextActive: { color: '#fff' },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 12, borderWidth: 0.5, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.text, fontFamily: FONTS.medium },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize', fontFamily: FONTS.medium },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  categoryText: { fontSize: 11, fontWeight: '500', fontFamily: FONTS.medium },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assignedText: { fontSize: 12, color: COLORS.textSecondary, fontFamily: FONTS.regular },
  dueDate: { fontSize: 12, color: COLORS.textSecondary, fontFamily: FONTS.regular },
  dueDateOverdue: { color: COLORS.danger, fontWeight: '600' },
  photoIndicator: { marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  photoCount: { fontSize: 12, color: COLORS.textSecondary, fontFamily: FONTS.regular },
  loader: { marginTop: 60 },
  emptyState: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary, fontFamily: FONTS.medium },
  emptySubtext: { fontSize: 13, color: COLORS.textTertiary, marginTop: 6, fontFamily: FONTS.regular },
});
