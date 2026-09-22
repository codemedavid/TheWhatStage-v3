import { Ionicons } from '@expo/vector-icons'
import { memo } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/ui/avatar'
import { Badge, StageChip } from '@/components/ui/primitives'
import { one, type LeadRow as LeadRowData, type PipelineStage } from '@/data/types'
import { relativeTime } from '@/lib/format'
import { dialable, firstFilled, type LatestContacts } from '@/lib/lead-contacts'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  lead: LeadRowData
  stage: PipelineStage | undefined
  /** Newest phone/email we hold, from the list's shared contact index. */
  latest?: LatestContacts
  /** Takes the lead so the list can pass one stable handler for every row. */
  onPress: (lead: LeadRowData) => void
}

export function contactLine(lead: Pick<LeadRowData, 'company' | 'email' | 'phone'>): string {
  return lead.company || lead.email || lead.phone || 'No contact info'
}

/**
 * The best number to dial: the freshest one the lead sent, else whatever an
 * operator saved on the lead, else the oldest captured value we still hold.
 */
export function callablePhone(lead: LeadRowData, latest?: LatestContacts): string | null {
  return firstFilled(latest?.phone?.value, lead.phone, lead.phones?.[0])
}

function LeadRowInner({ lead, stage, latest, onPress }: Props) {
  const thread = one(lead.messenger_threads)
  const unread = thread?.unread_count ?? 0
  const phone = callablePhone(lead, latest)
  const extras = (lead.phones?.length ?? 0) - 1

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(lead)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.borderSubtle }]}
    >
      <Avatar name={lead.name} uri={thread?.picture_url} size={46} dot={unread > 0} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.topLine}>
          <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={1}>
            {lead.name}
          </Text>
          <Text style={type.caption}>{relativeTime(lead.last_activity_at)}</Text>
        </View>
        {phone ? (
          <View style={styles.phoneLine}>
            <Ionicons name="call-outline" size={12} color={colors.tertiary} />
            <Text style={type.small} numberOfLines={1}>
              {phone}
            </Text>
            {extras > 0 && <Text style={type.caption}>+{extras} more</Text>}
          </View>
        ) : (
          <Text style={type.small} numberOfLines={1}>
            {contactLine(lead)}
          </Text>
        )}
        <View style={styles.bottomLine}>
          {stage ? <StageChip name={stage.name} kind={stage.kind} /> : <View />}
          <Badge count={unread} />
        </View>
      </View>
      {phone && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${lead.name}`}
          hitSlop={8}
          onPress={() => {
            Linking.openURL(`tel:${dialable(phone)}`).catch(() => {
              // No dialer on this device — tapping the row still opens the lead.
            })
          }}
          style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="call" size={17} color={colors.accent} />
        </Pressable>
      )}
    </Pressable>
  )
}

export const LeadRow = memo(LeadRowInner)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.page,
  },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  phoneLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bottomLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  callButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
    alignSelf: 'center',
  },
})
