import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BrandMark } from '@/components/ui/brand-mark'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth'
import { colors, radius, spacing, type } from '@/theme/tokens'

export default function SignInScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    const err = await signIn(email, password)
    setBusy(false)
    if (err) setError(err === 'Invalid login credentials' ? 'Wrong email or password.' : err)
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BrandMark size={64} style={styles.logo} />
          <Text style={type.display}>WhatStage</Text>
          <Text style={[type.body, { marginTop: 4, marginBottom: spacing.xxl }]}>
            Your pipeline, in your pocket.
          </Text>

          <Text style={type.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <Text style={[type.label, { marginTop: spacing.lg }]}>Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginTop: 0 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              secureTextEntry={!showPw}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Ionicons
              name={showPw ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.tertiary}
              onPress={() => setShowPw((v) => !v)}
              style={styles.eye}
            />
          </View>

          {error ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: 13, flex: 1 }}>{error}</Text>
            </View>
          ) : null}

          <Button label="Sign in" onPress={submit} loading={busy} size="lg" style={{ marginTop: spacing.xl }} />

          <Text style={[type.small, { textAlign: 'center', marginTop: spacing.xl }]}>
            Use the same email and password as the WhatStage dashboard.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xxl },
  logo: { marginBottom: spacing.lg },
  input: {
    marginTop: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  pwRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, position: 'relative' },
  eye: { position: 'absolute', right: 14 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
    backgroundColor: colors.dangerLight,
    padding: 10,
    borderRadius: radius.sm,
  },
})
