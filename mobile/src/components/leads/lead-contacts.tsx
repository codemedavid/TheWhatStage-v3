import { Ionicons } from '@expo/vector-icons'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, SectionLabel, Skeleton } from '@/components/ui/primitives'
import { useLeadContacts } from '@/data/leads'
import type { LeadContactValue } from '@/data/types'
import { relativeTime } from '@/lib/format'
import { contactSourceLabel, dialable } from '@/lib/lead-contacts'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  leadId: string
  /** The lead's official phone/email, badged so it stands out from the rest. */
  primaryPhone: string | null
  primaryEmail: string | null
}

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {
    // No dialer/mail client (simulator, tablet without SIM) — nothing to do.
  })
}

/**
 * Every phone number and email this lead ever handed over, newest first —
 * including the ones they only typed into a chat and nobody promoted to the
 * official Phone field. Each row dials or mails on tap so the operator can work
 * the list without copying anything by hand.
 */
export function LeadContacts({ leadId, primaryPhone, primaryEmail }: Props) {
  const contacts = useLeadContacts(leadId)
  const rows = contacts.data ?? []
  const phones = rows.filter((c) => c.kind === 'phone')
  const emails = rows.filter((c) => c.kind === 'email')

  return (
    <>
      <SectionLabel right={<Text style={type.caption}>{rows.length} collected</Text>}>
        Reach them
      </SectionLabel>
      <Card style={{ paddingVertical: 4 }}>
        {contacts.isLoading ? (
          <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="50%" height={16} />
          </View>
        ) : rows.length === 0 ? (
          <Text style={[type.small, { paddingVertical: spacing.sm }]}>
            {contacts.error
              ? `Could not load contacts: ${contacts.error.message}`
              : 'No phone or email captured yet. Anything they send in chat lands here automatically.'}
          </Text>
        ) : (
          <>
            {phones.map((c, i) => (
              <ContactLine
                key={c.id}
                contact={c}
                isPrimary={!!primaryPhone && dialable(primaryPhone) === dialable(c.value)}
                icon="call-outline"
                onPrimaryAction={() => openUrl(`tel:${dialable(c.value)}`)}
                secondaryIcon="chatbubble-outline"
                onSecondaryAction={() => openUrl(`sms:${dialable(c.value)}`)}
                last={i === phones.length - 1 && emails.length === 0}
              />
            ))}
            {emails.map((c, i) => (
              <ContactLine
                key={c.id}
                contact={c}
                isPrimary={primaryEmail?.toLowerCase() === c.value.toLowerCase()}
                icon="mail-outline"
                onPrimaryAction={() => openUrl(`mailto:${c.value}`)}
                last={i === emails.length - 1}
              />
            ))}
          </>
        )}
      </Card>
    </>
  )
}

interface LineProps {
  contact: LeadContactValue
  isPrimary: boolean
  icon: keyof typeof Ionicons.glyphMap
  onPrimaryAction: () => void
  secondaryIcon?: keyof typeof Ionicons.glyphMap
  onSecondaryAction?: () => void
  last: boolean
}

function ContactLine({
  contact,
  isPrimary,
  icon,
  onPrimaryAction,
  secondaryIcon,
  onSecondaryAction,
  last,
}: LineProps) {
  const isPhone = contact.kind === 'phone'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${isPhone ? 'Call' : 'Email'} ${contact.value}`}
      onPress={onPrimaryAction}
      style={({ pressed }) => [
        styles.line,
        last && { borderBottomWidth: 0 },
        pressed && { backgroundColor: colors.borderSubtle },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.tertiary} style={{ width: 24 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.valueLine}>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {contact.value}
          </Text>
          {isPrimary && (
            <View style={styles.primaryTag}>
              <Text style={styles.primaryTagText}>Primary</Text>
            </View>
          )}
        </View>
        <Text style={type.caption}>
          {contactSourceLabel(contact.source)} · {relativeTime(contact.collected_at)}
        </Text>
      </View>
      {secondaryIcon && onSecondaryAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Text ${contact.value}`}
          onPress={onSecondaryAction}
          hitSlop={8}
          style={styles.iconAction}
        >
          <Ionicons name={secondaryIcon} size={17} color={colors.accent} />
        </Pressable>
      )}
      <View style={styles.iconAction}>
        <Ionicons name={isPhone ? 'call' : 'mail'} size={17} color={colors.accent} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  valueLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primaryTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accentLight,
  },
  primaryTagText: { fontSize: 10, fontWeight: '600', color: colors.accentDeep, letterSpacing: 0.2 },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
})
