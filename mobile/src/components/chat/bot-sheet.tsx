import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { isTakenOver } from '@/components/chat/thread-row'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import type { ThreadRow } from '@/data/types'
import { useResumeBot, useSetAutoReply } from '@/data/threads'
import { relativeTime } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  visible: boolean
  onClose: () => void
  thread: ThreadRow
}

/** Bot controls for one conversation: the auto-reply switch and takeover resume. */
export function BotSheet({ visible, onClose, thread }: Props) {
  const setAutoReply = useSetAutoReply()
  const resumeBot = useResumeBot()
  const pausedUntil = thread.bot_paused_until
  const isPaused = isTakenOver(thread)
  const isOn = thread.auto_reply_enabled

  const toggle = (value: boolean) => {
    Haptics.selectionAsync().catch(() => {})
    setAutoReply.mutate({ threadId: thread.id, value })
  }

  const statusTitle = !isOn ? 'Bot is off' : isPaused ? 'Bot is paused' : 'Bot is on'
  const statusBody = !isOn
    ? 'The AI will not reply in this chat until you turn it back on.'
    : isPaused
      ? `You took over. The AI resumes ${relativeTime(pausedUntil)} unless you resume it now.`
      : 'The AI answers new messages in this chat automatically.'

  return (
    <Sheet visible={visible} onClose={onClose} title="Bot" subtitle="Auto-reply for this chat">
      <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
        <View style={[styles.status, isOn && !isPaused ? styles.statusOn : isOn ? styles.statusPaused : styles.statusOff]}>
          <Ionicons
            name={isOn && !isPaused ? 'sparkles' : isOn ? 'pause-circle-outline' : 'power-outline'}
            size={20}
            color={isOn && !isPaused ? colors.bubbleBotAccent : isOn ? colors.warning : colors.tertiary}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.bodyStrong}>{statusTitle}</Text>
            <Text style={type.small}>{statusBody}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.bodyStrong}>Allow bot to reply</Text>
            <Text style={type.small}>Turning it on also ends any takeover pause.</Text>
          </View>
          <Switch
            value={isOn}
            onValueChange={toggle}
            disabled={setAutoReply.isPending}
            trackColor={{ true: colors.accent, false: colors.faint }}
            accessibilityLabel="Allow bot to reply"
          />
        </View>

        {isOn && isPaused && (
          <Button
            label="Resume bot now"
            variant="secondary"
            loading={resumeBot.isPending}
            icon={<Ionicons name="play" size={15} color={colors.accent} />}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
              resumeBot.mutate(thread.id, { onSuccess: onClose })
            }}
          />
        )}

        {(setAutoReply.isError || resumeBot.isError) && (
          <Text style={styles.error}>Couldn&apos;t update the bot. Check your connection and try again.</Text>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statusOn: { backgroundColor: colors.bubbleBot, borderColor: '#C7D2FE' },
  statusPaused: { backgroundColor: colors.warningLight, borderColor: '#FDE68A' },
  statusOff: { backgroundColor: colors.borderSubtle, borderColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  error: { ...type.small, color: colors.danger, textAlign: 'center' },
})
