import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors, Brand } from '@/constants/theme';
import { formatCurrency, phpToSats } from '@/constants/currencies';
import { confirmWithBiometrics } from '@/services/biometrics';
import { findRecipient, sendMoney, walletErrorMessage, type Recipient } from '@/services/supabase';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function SendMoneyScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [recipientProfile, setRecipientProfile] = useState<Recipient | null>(null);

  const balance = profile?.balance ?? 0;
  const numAmount = parseFloat(amount) || 0;
  const satsAmount = phpToSats(numAmount);

  const quickChips = [100, 500, 1000, 2000];

  async function lookupRecipient() {
    if (!recipient.trim()) {
      Alert.alert('Error', 'Please enter a phone number or email');
      return;
    }

    setLoading(true);
    try {
      const data = await findRecipient(recipient);

      if (!data) {
        Alert.alert('Not Found', 'No user found with that email or phone number.');
        return;
      }
      if (data.id === user?.id) {
        Alert.alert('Error', 'You cannot send money to yourself.');
        return;
      }

      setRecipientProfile(data);
      setStep('confirm');
    } catch (err: any) {
      Alert.alert('Error', walletErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (amt > balance) {
      Alert.alert('Insufficient Balance', 'You do not have enough balance for this transfer.');
      return;
    }

    if (!recipientProfile) return;
    if (!(await confirmWithBiometrics(user?.id, `Confirm sending ${formatCurrency(amt)}`))) return;

    setLoading(true);
    try {
      await sendMoney(recipientProfile.id, amt, note || null);
      await refreshProfile();

      Alert.alert(
        'Transaction Broadcast!',
        `${formatCurrency(amt)} (${satsAmount.toLocaleString()} sats) sent instantly to ${recipientProfile.full_name ?? 'user'}.`,
        [{ text: 'Done', onPress: resetForm }],
      );
    } catch (err: any) {
      Alert.alert('Transfer Failed', walletErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setRecipient('');
    setAmount('');
    setNote('');
    setRecipientProfile(null);
    setStep('input');
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Top Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <BitcoinBadge size={32} glow={false} />
            <Text style={styles.headerTitle}>Send Payment</Text>
          </View>
          <View style={styles.balancePill}>
            <Text style={styles.balancePillLabel}>Available:</Text>
            <Text style={styles.balancePillValue}>{formatCurrency(balance)}</Text>
            <Text style={styles.balancePillSats}>({phpToSats(balance).toLocaleString()} sats)</Text>
          </View>
        </View>

        {step === 'input' ? (
          <View style={styles.card}>
            {/* Recipient Input */}
            <Text style={styles.label}>RECIPIENT (PHONE / EMAIL / LIGHTNING)</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="at" size={20} color={BitcoinColors.orange} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="name@example.com or 09xxxxxxxxx"
                placeholderTextColor={BitcoinColors.textMuted}
                value={recipient}
                onChangeText={setRecipient}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            {/* Amount Input */}
            <Text style={[styles.label, { marginTop: 18 }]}>AMOUNT TO SEND (PHP)</Text>
            <View style={styles.amountBox}>
              <View style={styles.amountInputRow}>
                <Text style={styles.currencySymbol}>₱</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="0.00"
                  placeholderTextColor={BitcoinColors.textMuted}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                />
              </View>

              {numAmount > 0 && (
                <View style={styles.satsConversionRow}>
                  <Text style={styles.satsConversionIcon}>⚡</Text>
                  <Text style={styles.satsConversionText}>
                    ≈ {satsAmount.toLocaleString()} SATS
                  </Text>
                </View>
              )}
            </View>

            {/* Quick Amount Chips */}
            <View style={styles.chipsRow}>
              {quickChips.map((val) => (
                <TouchableOpacity
                  key={val}
                  style={styles.chip}
                  onPress={() => setAmount(val.toString())}>
                  <Text style={styles.chipText}>₱{val.toLocaleString()}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.chip, styles.chipMax]}
                onPress={() => setAmount(balance.toString())}>
                <Text style={styles.chipMaxText}>MAX</Text>
              </TouchableOpacity>
            </View>

            {/* Note input */}
            <Text style={[styles.label, { marginTop: 18 }]}>MEMO / NOTE (OPTIONAL)</Text>
            <TextInput
              style={[styles.inputSingle, styles.noteInput]}
              placeholder="What is this payment for?"
              placeholderTextColor={BitcoinColors.textMuted}
              value={note}
              onChangeText={setNote}
              multiline
            />

            {/* Network fee indicator */}
            <View style={styles.feeBanner}>
              <Ionicons name="flash" size={16} color={BitcoinColors.lightning} />
              <Text style={styles.feeBannerText}>
                Instant Settlement • <Text style={{ color: BitcoinColors.green }}>0 Sats Network Fee</Text>
              </Text>
            </View>

            {/* Continue Button */}
            <TouchableOpacity
              style={[styles.btnWrap, loading && styles.btnDisabled]}
              onPress={lookupRecipient}
              disabled={loading}
              activeOpacity={0.85}>
              <LinearGradient
                colors={Brand.gradientButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.btnGradient}>
                <Text style={styles.btnText}>{loading ? 'Verifying Recipient...' : 'Review Payment'}</Text>
                <Ionicons name="arrow-forward" size={18} color="#07090E" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.confirmHeader}>
              <BitcoinBadge size={44} glow={true} />
              <Text style={styles.confirmTitle}>Confirm Transaction</Text>
              <Text style={styles.confirmSubtitle}>Review destination before broadcasting</Text>
            </View>

            <View style={styles.confirmCardBox}>
              <View style={styles.confirmRow}>
                <View style={styles.confirmAvatarCircle}>
                  <Ionicons name="person" size={24} color={BitcoinColors.orange} />
                </View>
                <View style={styles.confirmInfo}>
                  <Text style={styles.confirmName}>{recipientProfile?.full_name ?? 'User'}</Text>
                  <Text style={styles.confirmDetail}>
                    {recipient.trim()}
                  </Text>
                </View>
              </View>

              <View style={styles.confirmDivider} />

              <View style={styles.confirmDataRow}>
                <Text style={styles.confirmDataLabel}>Amount (PHP)</Text>
                <Text style={styles.confirmDataValue}>{formatCurrency(numAmount)}</Text>
              </View>

              <View style={styles.confirmDataRow}>
                <Text style={styles.confirmDataLabel}>Sats Equivalent</Text>
                <Text style={[styles.confirmDataValue, { color: BitcoinColors.gold }]}>
                  ⚡ {satsAmount.toLocaleString()} sats
                </Text>
              </View>

              <View style={styles.confirmDataRow}>
                <Text style={styles.confirmDataLabel}>Routing Fee</Text>
                <Text style={[styles.confirmDataValue, { color: BitcoinColors.green }]}>FREE (0 sats)</Text>
              </View>

              {note ? (
                <View style={styles.confirmDataRow}>
                  <Text style={styles.confirmDataLabel}>Memo</Text>
                  <Text style={styles.confirmDataValue}>{note}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
                <Text style={styles.cancelBtnText}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sendBtn, loading && styles.btnDisabled]}
                onPress={handleSend}
                disabled={loading}
                activeOpacity={0.85}>
                <LinearGradient
                  colors={Brand.gradientButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.sendBtnGradient}>
                  <Ionicons name="flash" size={18} color="#07090E" />
                  <Text style={styles.sendBtnText}>{loading ? 'Broadcasting...' : 'Broadcast Payment'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scroll: {
    paddingBottom: 24,
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignSelf: 'flex-start',
    gap: 6,
  },
  balancePillLabel: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    fontWeight: '600',
  },
  balancePillValue: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  balancePillSats: {
    fontSize: 11,
    color: BitcoinColors.gold,
    fontWeight: '700',
  },
  card: {
    marginHorizontal: 20,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  inputSingle: {
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  amountBox: {
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    borderRadius: 16,
    padding: 16,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '900',
    color: BitcoinColors.orange,
    marginRight: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  satsConversionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    gap: 4,
  },
  satsConversionIcon: {
    color: BitcoinColors.lightning,
    fontSize: 12,
  },
  satsConversionText: {
    color: BitcoinColors.gold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  chipMax: {
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    borderColor: 'rgba(247, 147, 26, 0.35)',
  },
  chipMaxText: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  noteInput: {
    height: 70,
    textAlignVertical: 'top',
  },
  feeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 18,
    gap: 8,
  },
  feeBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  btnWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 22,
  },
  btnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 8,
  },
  btnText: {
    color: '#07090E',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  confirmHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 10,
  },
  confirmSubtitle: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 4,
  },
  confirmCardBox: {
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 22,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  confirmInfo: {
    flex: 1,
  },
  confirmName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  confirmDetail: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  confirmDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 14,
  },
  confirmDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  confirmDataLabel: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
  },
  confirmDataValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  cancelBtnText: {
    color: BitcoinColors.textSecondary,
    fontWeight: '700',
    fontSize: 14,
  },
  sendBtn: {
    flex: 2,
    borderRadius: 14,
    overflow: 'hidden',
  },
  sendBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  sendBtnText: {
    color: '#07090E',
    fontWeight: '800',
    fontSize: 14,
  },
});
