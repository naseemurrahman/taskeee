import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchTaskDetail } from '../store/taskSlice';
import { api } from '../services/api';
import { COLORS } from '../theme';

export default function TaskDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useAppDispatch();
  const { selectedTask } = useAppSelector((s) => s.tasks);
  const taskId = route.params?.taskId as string;
  const [messages, setMessages] = useState<any[]>([]);
  const [chatText, setChatText] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);

  useEffect(() => {
    if (taskId) dispatch(fetchTaskDetail(taskId));
  }, [dispatch, taskId]);

  const loadChat = useCallback(async () => {
    if (!taskId) return;
    setLoadingChat(true);
    try {
      const { data } = await api.get(`/tasks/${taskId}/messages`);
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingChat(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  const sendChat = async () => {
    if (!taskId || !chatText.trim()) return;
    try {
      await api.post(`/tasks/${taskId}/messages`, { body: chatText.trim() });
      setChatText('');
      loadChat();
    } catch { /* toast in app */ }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{selectedTask?.title || 'Task Details'}</Text>
        <Text style={styles.subtitle}>{selectedTask?.description || 'No description available.'}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('PhotoUpload', { taskId })}
        >
          <Text style={styles.buttonText}>Upload evidence (photo / PDF / Excel)</Text>
        </TouchableOpacity>

        <Text style={styles.chatTitle}>Team chat</Text>
        <View style={styles.chatBox}>
          {loadingChat ? (
            <Text style={styles.muted}>Loading messages…</Text>
          ) : messages.length === 0 ? (
            <Text style={styles.muted}>No messages yet.</Text>
          ) : (
            messages.map((m) => (
              <View key={m.id} style={styles.msg}>
                <Text style={styles.msgMeta}>{m.sender_name || 'User'} · {new Date(m.created_at).toLocaleString()}</Text>
                <Text style={styles.msgBody}>{m.body}</Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder="Message your manager…"
            value={chatText}
            onChangeText={setChatText}
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={sendChat}>
            <Text style={styles.sendTxt}>Send</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 20 },
  button: { height: 48, borderRadius: 10, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  chatTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  chatBox: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, minHeight: 120, backgroundColor: '#fff', marginBottom: 10 },
  muted: { color: COLORS.textSecondary, fontSize: 13 },
  msg: { marginBottom: 10 },
  msgMeta: { fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 },
  msgBody: { fontSize: 14, color: COLORS.text },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1, minHeight: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: COLORS.text, backgroundColor: '#fff',
  },
  sendBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 },
  sendTxt: { color: '#fff', fontWeight: '600' },
});
