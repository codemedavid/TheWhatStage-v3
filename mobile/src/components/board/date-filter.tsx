import { Ionicons } from '@expo/vector-icons'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import {
  BASIS_LABELS,
  DEFAULT_DATE_FILTER,
  PRESET_LABELS,
  describeFilter,
  type DateBasis,
  type DateFilter,
  type DatePreset,
} from '@/lib/date-range'
import { colors, radius, spacing, type } from '@/theme/tokens'

const PRESETS: DatePreset[] = ['all', 'today', 'yesterday', '7d', '30d']
const BASES: DateBasis[] = ['activity', 'created', 'stage']

interface Props {
  value: DateFilter
  onChange: (next: DateFilter) => void
}

/** Chip strip above the board: quick presets plus a sheet for custom ranges and basis. */
export function DateFilterBar({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const isActive = value.preset !== 'all'

  const pick = (preset: DatePreset) => {
    Haptics.selectionAsync().catch(() => {})
    onChange({ ...value, preset })
  }

  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {PRESETS.map((p) => (
          <Pill key={p} label={PRESET_LABELS[p]} active={value.preset === p} onPress={() => pick(p)} />
        ))}
        <Pill
          label={value.preset === 'custom' ? describeFilter(value) : 'Custom'}
          active={value.preset === 'custom'}
          icon={<Ionicons name="calendar-outline" size={13} color={value.preset === 'custom' ? '#fff' : colors.tertiary} />}
          onPress={() => setOpen(true)}
        />
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Date filter options"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.gear, isActive && styles.gearActive, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="options-outline" size={18} color={isActive ? colors.accent : colors.tertiary} />
      </Pressable>
      <DateFilterSheet visible={open} onClose={() => setOpen(false)} value={value} onChange={onChange} />
    </View>
  )
}

function DateFilterSheet({ visible, onClose, value, onChange }: Props & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Filter by date" subtitle="Show leads whose date falls in a range">
      {visible && <DateFilterForm value={value} onApply={(next) => { onChange(next); onClose() }} />}
    </Sheet>
  )
}

function DateFilterForm({ value, onApply }: { value: DateFilter; onApply: (next: DateFilter) => void }) {
  const [draft, setDraft] = useState<DateFilter>(value)
  const [editing, setEditing] = useState<'from' | 'to' | null>(null)

  const fromDate = draft.customFrom ? new Date(draft.customFrom) : new Date()
  const toDate = draft.customTo ? new Date(draft.customTo) : new Date()

  const setDate = (which: 'from' | 'to', e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== 'ios') setEditing(null)
    if (e.type === 'dismissed' || !date) return
    const iso = date.toISOString()
    setDraft((d) => ({ ...d, preset: 'custom', [which === 'from' ? 'customFrom' : 'customTo']: iso }))
  }

  const fmt = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const isCustom = draft.preset === 'custom'
  const isCustomInvalid = isCustom && draft.customFrom && draft.customTo && new Date(draft.customFrom) > new Date(draft.customTo)

  return (
    <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>Range</Text>
        <View style={styles.wrapRow}>
          {[...PRESETS, 'custom' as const].map((p) => (
            <Pill key={p} label={PRESET_LABELS[p]} active={draft.preset === p} onPress={() => setDraft((d) => ({ ...d, preset: p }))} />
          ))}
        </View>
      </View>

      {isCustom && (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.dateRow}>
            <DateField label="From" text={draft.customFrom ? fmt(fromDate) : 'Pick a day'} active={editing === 'from'} onPress={() => setEditing(editing === 'from' ? null : 'from')} />
            <DateField label="To" text={draft.customTo ? fmt(toDate) : 'Pick a day'} active={editing === 'to'} onPress={() => setEditing(editing === 'to' ? null : 'to')} />
          </View>
          {editing && (
            <DateTimePicker
              value={editing === 'from' ? fromDate : toDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              maximumDate={new Date()}
              accentColor={colors.accent}
              onChange={(e, d) => setDate(editing, e, d)}
            />
          )}
          {isCustomInvalid ? <Text style={styles.error}>The start date must be before the end date.</Text> : null}
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>Date to use</Text>
        <View style={styles.wrapRow}>
          {BASES.map((b) => (
            <Pill key={b} label={BASIS_LABELS[b]} active={draft.basis === b} onPress={() => setDraft((d) => ({ ...d, basis: b }))} />
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Reset" variant="secondary" style={{ flex: 1 }} onPress={() => onApply(DEFAULT_DATE_FILTER)} />
        <Button label="Apply" style={{ flex: 2 }} disabled={!!isCustomInvalid} onPress={() => onApply(draft)} />
      </View>
    </View>
  )
}

function DateField({ label, text, active, onPress }: { label: string; text: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} date`} onPress={onPress} style={[styles.field, active && styles.fieldActive]}>
      <Text style={type.caption}>{label}</Text>
      <Text style={type.bodyStrong}>{text}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.page,
  },
  strip: { gap: 8, paddingRight: spacing.sm },
  gear: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.borderSubtle,
  },
  gearActive: { backgroundColor: colors.accentLight },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  field: {
    flex: 1,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldActive: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  error: { ...type.small, color: colors.danger },
})
