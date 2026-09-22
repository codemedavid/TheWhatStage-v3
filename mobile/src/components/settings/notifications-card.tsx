import { Switch } from 'react-native'
import { Card, Row, SectionLabel } from '@/components/ui/primitives'
import { usePush } from '@/providers/push'
import { colors } from '@/theme/tokens'

/**
 * The mute switch for inbound-message push on this device.
 *
 * Renders nothing until the device is actually registered: every other status
 * is a build or permission detail the operator can neither act on nor needs to
 * read. Registration happens in PushProvider regardless of this card, so
 * hiding it never costs a notification.
 */
export function NotificationsCard() {
  const { status, enabled, setEnabled, isSaving } = usePush()

  if (status !== 'registered') return null

  return (
    <>
      <SectionLabel>Notifications</SectionLabel>
      <Card style={{ paddingVertical: 4 }}>
        <Row
          icon="notifications-outline"
          label="Push"
          value={enabled ? 'New messages on this device' : 'Muted on this device'}
          right={
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              disabled={isSaving}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          }
        />
      </Card>
    </>
  )
}
