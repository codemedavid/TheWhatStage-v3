import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { NotificationsCard } from '@/components/settings/notifications-card'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, Row, SectionLabel } from '@/components/ui/primitives'
import { ScreenHeader } from '@/components/ui/screen-header'
import { env } from '@/lib/env'
import { useAuth } from '@/providers/auth'
import { colors, spacing, type } from '@/theme/tokens'

export default function MeTab() {
  const router = useRouter()
  const { profile, email, signOut } = useAuth()
  const name = profile?.fullName || email
  const version = Constants.expoConfig?.version ?? '—'

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Me" large bordered={false} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profile}>
          <Avatar name={name} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={type.heading} numberOfLines={1}>
              {name}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {email}
            </Text>
            <Text style={[type.caption, { marginTop: 4 }]}>{profile?.role ?? 'user'}</Text>
          </View>
        </Card>

        <SectionLabel>Workspace</SectionLabel>
        <Card style={{ paddingVertical: 4 }}>
          <Row
            icon="bookmark-outline"
            label="Replies"
            value="Saved messages"
            onPress={() => router.push('/saved-messages')}
          />
          <View style={styles.divider} />
          <Row
            icon="clipboard-outline"
            label="Action pages"
            value="Submissions"
            onPress={() => router.push('/submissions')}
          />
          <View style={styles.divider} />
          <Row
            icon="open-outline"
            label="Web"
            value="Open web dashboard"
            onPress={() => Linking.openURL(`${env.apiUrl}/dashboard`).catch(() => {})}
          />
        </Card>

        <NotificationsCard />

        <Button label="Sign out" variant="danger" onPress={signOut} style={{ marginTop: spacing.xxl }} />
        <Text style={[type.caption, { textAlign: 'center', marginTop: spacing.lg }]}>
          WhatStage {version}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.lg, paddingBottom: 40 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
})
