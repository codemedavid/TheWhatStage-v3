import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { StageChip } from '@/components/ui/primitives'
import { one, type LeadRow, type PipelineStage } from '@/data/types'
import { money, relativeTime } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  lead: LeadRow
  stage: PipelineStage | undefined
  editing: boolean
  draftName: string
  onChangeName: (name: string) => void
  onPressStage: () => void
  hasThread: boolean
  onMessage: () => void
  onNewProject: () => void
}

export function LeadHeader({
  lead,
  stage,
  editing,
  draftName,
  onChangeName,
  onPressStage,
  hasThread,
  onMessage,
  onNewProject,
}: Props) {
  const thread = one(lead.messenger_threads)
  return (
    <View style={styles.wrap}>
      <Avatar name={lead.name} uri={thread?.picture_url} size={72} ring={hasThread} />
      {editing ? (
        <TextInput
          style={styles.nameInput}
          value={draftName}
          onChangeText={onChangeName}
          placeholder="Lead name"
          placeholderTextColor={colors.muted}
          autoFocus
        />
      ) : (
        <Text style={[type.title, { marginTop: spacing.md, textAlign: 'center' }]}>{lead.name}</Text>
      )}
      <View style={{ marginTop: spacing.sm }}>
        {stage ? (
          <StageChip name={stage.name} kind={stage.kind} onPress={onPressStage} />
        ) : (
          <StageChip name="No stage" onPress={onPressStage} />
        )}
      </View>

      <View style={styles.actions}>
        <Button
          label="Message"
          onPress={onMessage}
          disabled={!hasThread}
          icon={<Ionicons name="chatbubble" size={15} color="#fff" />}
          style={{ flex: 1 }}
        />
        <Button
          label="New project"
          variant="secondary"
          onPress={onNewProject}
          icon={<Ionicons name="add" size={17} color={colors.ink} />}
          style={{ flex: 1 }}
        />
      </View>
      {!hasThread ? <Text style={[type.caption, { marginTop: 6 }]}>No Messenger thread for this lead</Text> : null}

      <View style={styles.stats}>
        <Stat label="Value" value={money(lead.estimated_value) || '—'} />
        <Stat label="In stage" value={lead.entered_stage_at ? `${relativeTime(lead.entered_stage_at)} ago` : '—'} />
        <Stat label="Score" value={lead.score == null ? '—' : String(lead.score)} />
      </View>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={type.caption}>{label}</Text>
      <Text style={[type.bodyStrong, { marginTop: 2 }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  nameInput: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.accentGlow,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
})
