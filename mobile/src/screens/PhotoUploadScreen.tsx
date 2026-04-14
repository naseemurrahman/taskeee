// src/screens/PhotoUploadScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert,
  ActivityIndicator, ScrollView, Platform
} from 'react-native';
import { launchCamera, launchImageLibrary, CameraOptions } from 'react-native-image-picker';
import Geolocation from '@react-native-community/geolocation';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { uploadTaskPhoto } from '../store/taskSlice';
import { COLORS, FONTS } from '../theme';

const AI_STATUS_CONFIG = {
  ai_reviewing: {
    icon: '🔍', label: 'AI is reviewing your photo...',
    color: COLORS.primary, bg: '#EDE9FE'
  },
  approved: {
    icon: '✅', label: 'Approved by AI',
    color: '#065F46', bg: '#D1FAE5'
  },
  ai_approved: {
    icon: '✅', label: 'Approved by AI',
    color: '#065F46', bg: '#D1FAE5'
  },
  rejected: {
    icon: '❌', label: 'Rejected by AI',
    color: '#991B1B', bg: '#FEE2E2'
  },
  ai_rejected: {
    icon: '❌', label: 'Rejected — resubmit',
    color: '#991B1B', bg: '#FEE2E2'
  },
  manual_review: {
    icon: '👤', label: 'Sent for manual review',
    color: '#92400E', bg: '#FEF3C7'
  },
};

export default function PhotoUploadScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useAppDispatch();
  const { uploading, error, selectedTask } = useAppSelector(s => s.tasks);

  const taskId = route.params?.taskId;
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);

  useEffect(() => {
    // Try to get GPS location in background
    Geolocation.getCurrentPosition(
      pos => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => console.log('Location unavailable:', err.message),
      { timeout: 10000, enableHighAccuracy: false }
    );
  }, []);

  const openCamera = () => {
    const opts: CameraOptions = {
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: false,
      includeBase64: false,
    };
    launchCamera(opts, (res) => {
      if (res.didCancel) return;
      if (res.errorCode) { Alert.alert('Camera Error', res.errorMessage); return; }
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setPhotoUri(asset.uri);
        setUploadResult(null);
      }
    });
  };

  const openGallery = () => {
    launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, (res) => {
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setPhotoUri(asset.uri);
        setUploadResult(null);
      }
    });
  };

  const handleSubmit = async () => {
    if (!photoUri) { Alert.alert('No photo', 'Please take or select a photo first.'); return; }

    const result = await dispatch(uploadTaskPhoto({
      taskId,
      photoUri,
      geoLat: location?.lat,
      geoLng: location?.lng,
    }));

    if (uploadTaskPhoto.fulfilled.match(result)) {
      setUploadResult(result.payload);
      // Poll for AI result every 3 seconds for up to 30s
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const { api } = require('../services/api');
          const { data } = await api.get(`/tasks/${taskId}`);
          const aiStatus = data.task.status;
          if (['ai_approved', 'ai_rejected', 'submitted'].includes(aiStatus) || attempts > 10) {
            clearInterval(poll);
            setUploadResult({ ...result.payload, aiStatus: data.task.status });
          }
        } catch { clearInterval(poll); }
      }, 3000);
    } else if (uploadTaskPhoto.rejected.match(result)) {
      Alert.alert('Upload Failed', result.payload as string || 'Please try again.');
    }
  };

  const aiStatus = uploadResult?.aiStatus || (uploadResult ? 'ai_reviewing' : null);
  const aiConfig = aiStatus ? AI_STATUS_CONFIG[aiStatus] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.instruction}>
        Take a clear photo showing the completed task. The AI will verify it automatically.
      </Text>

      {/* Photo Area */}
      {!photoUri ? (
        <View style={styles.emptyPhoto}>
          <Text style={styles.cameraIcon}>📷</Text>
          <Text style={styles.emptyPhotoText}>No photo selected</Text>
        </View>
      ) : (
        <View style={styles.photoContainer}>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          {location && (
            <View style={styles.gpsTag}>
              <Text style={styles.gpsText}>📍 GPS attached</Text>
            </View>
          )}
        </View>
      )}

      {/* Action buttons */}
      {!uploadResult && (
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.actionBtn, styles.cameraBtn]} onPress={openCamera}>
            <Text style={styles.actionBtnText}>📷  Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.galleryBtn]} onPress={openGallery}>
            <Text style={[styles.actionBtnText, { color: COLORS.primary }]}>🖼  Gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* AI Result */}
      {aiConfig && (
        <View style={[styles.aiResult, { backgroundColor: aiConfig.bg }]}>
          <Text style={styles.aiIcon}>{aiConfig.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.aiLabel, { color: aiConfig.color }]}>{aiConfig.label}</Text>
            {aiStatus === 'ai_reviewing' && (
              <ActivityIndicator color={aiConfig.color} style={{ marginTop: 6, alignSelf: 'flex-start' }} />
            )}
            {aiStatus === 'ai_rejected' && (
              <Text style={styles.aiNote}>Please retake the photo making sure the completed work is clearly visible.</Text>
            )}
            {aiStatus === 'manual_review' && (
              <Text style={styles.aiNote}>Your manager will review the photo.</Text>
            )}
          </View>
        </View>
      )}

      {/* Submit / Done */}
      {!uploadResult ? (
        <TouchableOpacity
          style={[styles.submitBtn, (!photoUri || uploading) && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!photoUri || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Submit for AI Review</Text>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.doneActions}>
          {(aiStatus === 'ai_rejected') && (
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: COLORS.warning }]}
              onPress={() => { setPhotoUri(null); setUploadResult(null); openCamera(); }}
            >
              <Text style={styles.submitBtnText}>Retake Photo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: COLORS.textSecondary, marginTop: 12 }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.submitBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.tips}>
        <Text style={styles.tipsTitle}>📌 Tips for AI approval:</Text>
        <Text style={styles.tipItem}>• Ensure good lighting and a clear, in-focus image</Text>
        <Text style={styles.tipItem}>• Show the full work area, not just a close-up</Text>
        <Text style={styles.tipItem}>• Avoid blurry or dark photos</Text>
        <Text style={styles.tipItem}>• Make the completion evidence clearly visible</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 60 },
  instruction: {
    fontSize: 14, color: COLORS.textSecondary, lineHeight: 20,
    marginBottom: 20, fontFamily: FONTS.regular
  },
  emptyPhoto: {
    height: 240, borderRadius: 14, borderWidth: 2, borderColor: COLORS.border,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F9FAFB', marginBottom: 20,
  },
  cameraIcon: { fontSize: 48, marginBottom: 12 },
  emptyPhotoText: { fontSize: 14, color: COLORS.textSecondary, fontFamily: FONTS.regular },
  photoContainer: { marginBottom: 20, borderRadius: 14, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: 280, borderRadius: 14 },
  gpsTag: {
    position: 'absolute', bottom: 10, left: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 8,
  },
  gpsText: { fontSize: 11, color: '#fff', fontFamily: FONTS.medium },
  buttonRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  actionBtn: {
    flex: 1, height: 48, borderRadius: 10, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1,
  },
  cameraBtn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  galleryBtn: { backgroundColor: '#fff', borderColor: COLORS.primary },
  actionBtnText: { fontSize: 15, fontWeight: '600', color: '#fff', fontFamily: FONTS.medium },
  aiResult: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 16, borderRadius: 12, marginBottom: 20,
  },
  aiIcon: { fontSize: 24 },
  aiLabel: { fontSize: 15, fontWeight: '600', fontFamily: FONTS.medium },
  aiNote: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, fontFamily: FONTS.regular },
  submitBtn: {
    height: 52, borderRadius: 12, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 16, fontWeight: '600', color: '#fff', fontFamily: FONTS.medium },
  doneActions: { marginBottom: 20 },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  tips: {
    marginTop: 28, padding: 16, backgroundColor: '#F0FDF4',
    borderRadius: 12, borderWidth: 0.5, borderColor: '#BBF7D0',
  },
  tipsTitle: { fontSize: 13, fontWeight: '600', color: '#065F46', marginBottom: 8, fontFamily: FONTS.medium },
  tipItem: { fontSize: 12, color: '#047857', lineHeight: 22, fontFamily: FONTS.regular },
});
