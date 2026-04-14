// src/store/taskSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../services/api';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedToName: string;
  assignedByName: string;
  categoryName?: string;
  categoryColor?: string;
  dueDate?: string;
  location?: string;
  photoCount: number;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
}

interface TaskState {
  tasks: Task[];
  selectedTask: Task | null;
  timeline: any[];
  photos: any[];
  loading: boolean;
  uploading: boolean;
  error: string | null;
  pagination: { page: number; total: number; pages: number };
  filters: { status?: string; priority?: string };
}

const initialState: TaskState = {
  tasks: [],
  selectedTask: null,
  timeline: [],
  photos: [],
  loading: false,
  uploading: false,
  error: null,
  pagination: { page: 1, total: 0, pages: 1 },
  filters: {},
};

export const fetchTasks = createAsyncThunk(
  'tasks/fetchAll',
  async (params: { page?: number; status?: string; priority?: string } = {}, { rejectWithValue }) => {
    try {
      const { data } = await api.get('/tasks', { params: { ...params, limit: 20 } });
      return data;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Failed to load tasks');
    }
  }
);

export const fetchTaskDetail = createAsyncThunk(
  'tasks/fetchDetail',
  async (taskId: string, { rejectWithValue }) => {
    try {
      const { data } = await api.get(`/tasks/${taskId}`);
      return data;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Failed to load task');
    }
  }
);

export const updateTaskStatus = createAsyncThunk(
  'tasks/updateStatus',
  async ({ taskId, status, note }: { taskId: string; status: string; note?: string }, { rejectWithValue }) => {
    try {
      const { data } = await api.patch(`/tasks/${taskId}/status`, { status, note });
      return { taskId, status };
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Failed to update status');
    }
  }
);

export const uploadTaskPhoto = createAsyncThunk(
  'tasks/uploadPhoto',
  async ({ taskId, photoUri, geoLat, geoLng }: {
    taskId: string; photoUri: string; geoLat?: number; geoLng?: number
  }, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('photo', {
        uri: photoUri,
        type: 'image/jpeg',
        name: `task_${taskId}_${Date.now()}.jpg`,
      } as any);
      formData.append('taskId', taskId);
      if (geoLat) formData.append('geoLat', String(geoLat));
      if (geoLng) formData.append('geoLng', String(geoLng));
      formData.append('takenAt', new Date().toISOString());

      const { data } = await api.post('/photos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Upload failed');
    }
  }
);

const taskSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    setFilter: (state, action: PayloadAction<{ status?: string; priority?: string }>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => { state.filters = {}; },
    updateTaskInList: (state, action: PayloadAction<{ taskId: string; status: string }>) => {
      const task = state.tasks.find(t => t.id === action.payload.taskId);
      if (task) task.status = action.payload.status;
      if (state.selectedTask?.id === action.payload.taskId) {
        state.selectedTask.status = action.payload.status;
      }
    },
    clearError: (state) => { state.error = null; }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTasks.pending, (state) => { state.loading = true; })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.loading = false;
        state.tasks = action.payload.tasks;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(fetchTaskDetail.pending, (state) => { state.loading = true; })
      .addCase(fetchTaskDetail.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedTask = action.payload.task;
        state.timeline = action.payload.timeline;
        state.photos = action.payload.photos;
      })
      .addCase(uploadTaskPhoto.pending, (state) => { state.uploading = true; state.error = null; })
      .addCase(uploadTaskPhoto.fulfilled, (state) => { state.uploading = false; })
      .addCase(uploadTaskPhoto.rejected, (state, action) => {
        state.uploading = false;
        state.error = action.payload as string;
      })
      .addCase(updateTaskStatus.fulfilled, (state, action) => {
        const { taskId, status } = action.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) task.status = status;
      });
  }
});

export const { setFilter, clearFilters, updateTaskInList, clearError } = taskSlice.actions;
export default taskSlice.reducer;
