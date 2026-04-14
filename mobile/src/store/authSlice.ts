// src/store/authSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'employee' | 'supervisor' | 'manager' | 'director' | 'admin';
  orgId: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  isAuthenticated: false,
  loading: true,
  error: null,
};

export const login = createAsyncThunk(
  'auth/login',
  async ({ email, password }: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await AsyncStorage.multiSet([
        ['accessToken', data.accessToken],
        ['refreshToken', data.refreshToken],
        ['user', JSON.stringify(data.user)],
      ]);
      return data;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Login failed');
    }
  }
);

export const restoreSession = createAsyncThunk('auth/restoreSession', async () => {
  const [[, token], [, userStr]] = await AsyncStorage.multiGet(['accessToken', 'user']);
  if (!token || !userStr) return null;
  return { accessToken: token, user: JSON.parse(userStr) };
});

export const logout = createAsyncThunk('auth/logout', async (_, { getState }) => {
  const refreshToken = await AsyncStorage.getItem('refreshToken');
  try {
    await api.post('/auth/logout', { refreshToken });
  } catch { /* ignore */ }
  await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'user']);
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAccessToken: (state, action: PayloadAction<string>) => {
      state.accessToken = action.payload;
    },
    clearError: (state) => { state.error = null; }
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload) {
          state.user = action.payload.user;
          state.accessToken = action.payload.accessToken;
          state.isAuthenticated = true;
        }
      })
      .addCase(restoreSession.rejected, (state) => { state.loading = false; })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
      });
  }
});

export const { setAccessToken, clearError } = authSlice.actions;
export default authSlice.reducer;
