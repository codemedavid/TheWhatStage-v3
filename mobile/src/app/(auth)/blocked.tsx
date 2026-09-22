import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth'
import { colors, spacing, type } from '@/theme/tokens'

export default function BlockedScreen() {
  const { profile, signOut } = useAuth()
  const pending = profile?.status === 'pending'
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.box}>
        <View style={styles.icon}>
          <Ionicons name={pending ? 'hourglass-outline' : 'pause-circle-outline'} size={28} color={colors.warning} />
        </View>
        <Text style={type.title}>{pending ? 'Account pending' : 'Account paused'}</Text>
        <Text style={[type.body, { textAlign: 'center', marginTop: 6 }]}>
          {pending
            ? 'Your WhatStage account is waiting for approval. You will be able to sign in once it is activated.'
            : 'Your WhatStage account is paused. Contact support to restore access.'}
        </Text>
        <Button label="Sign out" variant="secondary" onPress={signOut} style={{ marginTop: spacing.xl }} />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page, justifyContent: 'center' },
  box: { alignItems: 'center', padding: spacing.xxl },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
})
