import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors } from '@/constants/theme';
import { documentTypeLabel, kycErrorMessage, listPendingReviews, type KycVerification } from '@/services/kyc';

export default function KycReviewQueueScreen() {
  const [items, setItems] = useState<KycVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listPendingReviews());
      setError(null);
    } catch (e) {
      setError(kycErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Review Submissions" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BitcoinColors.orange}
            colors={[BitcoinColors.orange]}
          />
        }>
        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : error ? (
          <View style={styles.emptyCard}>
            <Ionicons name="cloud-offline-outline" size={26} color={BitcoinColors.red} />
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-outline" size={26} color={BitcoinColors.green} />
            <Text style={styles.emptyText}>Nothing waiting for review.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>OLDEST FIRST</Text>
            {items.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/kyc/review/[id]', params: { id: item.id } })}
                activeOpacity={0.75}
                accessibilityRole="button">
                <View style={styles.rowIcon}>
                  <Ionicons name="person" size={18} color={BitcoinColors.cyan} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.legal_name ?? 'Unnamed'}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {documentTypeLabel(item.document_type)}
                    {item.submitted_at
                      ? ` · sent ${new Date(item.submitted_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}`
                      : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={BitcoinColors.textMuted} />
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  scroll: { padding: 20, paddingBottom: 40 },
  loader: { marginTop: 40 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.1,
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 10,
  },
  emptyText: { fontSize: 13, lineHeight: 19, color: BitcoinColors.textSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  rowSub: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 2 },
});
