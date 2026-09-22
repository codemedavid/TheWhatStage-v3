import { useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import type { Workspace } from '@/data/types'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  visible: boolean
  onClose: () => void
  leadName: string
  workspaces: Workspace[]
  busy: boolean
  error: string | null
  onCreate: (input: { workspaceId: string; title: string; value: number | null }) => void
}

export function NewProjectSheet({ visible, onClose, leadName, workspaces, busy, error, onCreate }: Props) {
  // The Modal unmounts its children while hidden, so the form's state resets
  // on every open without an effect.
  return (
    <Sheet visible={visible} onClose={onClose} title="New project" subtitle={`For ${leadName}`}>
      <NewProjectForm leadName={leadName} workspaces={workspaces} busy={busy} error={error} onCreate={onCreate} />
    </Sheet>
  )
}

type FormProps = Omit<Props, 'visible' | 'onClose'>

function NewProjectForm({ leadName, workspaces, busy, error, onCreate }: FormProps) {
  const defaultWs = workspaces.find((w) => w.is_default) ?? workspaces[0]
  const [workspaceId, setWorkspaceId] = useState<string | null>(defaultWs?.id ?? null)
  const [title, setTitle] = useState(`${leadName} deal`)
  const [value, setValue] = useState('')

  const parsedValue = value.trim() === '' ? null : Number(value)
  const valueInvalid = parsedValue != null && (Number.isNaN(parsedValue) || parsedValue < 0)
  const canCreate = !!workspaceId && title.trim().length > 0 && !valueInvalid && !busy

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg }}>
        <View>
          <Text style={type.label}>Workspace</Text>
          <View style={styles.pills}>
            {workspaces.map((w) => (
              <Pill key={w.id} label={w.name} active={w.id === workspaceId} onPress={() => setWorkspaceId(w.id)} />
            ))}
            {workspaces.length === 0 && <Text style={type.small}>No workspaces yet — create one on the web.</Text>}
          </View>
        </View>
        <View>
          <Text style={type.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Project title"
            placeholderTextColor={colors.muted}
            maxLength={160}
          />
        </View>
        <View>
          <Text style={type.label}>Value (optional)</Text>
          <TextInput
            style={[styles.input, valueInvalid && { borderColor: colors.danger }]}
            value={value}
            onChangeText={setValue}
            placeholder="0"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
          />
        </View>
        {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : null}
        <Button
          label="Create project"
          onPress={() => workspaceId && onCreate({ workspaceId, title, value: parsedValue })}
          disabled={!canCreate}
          loading={busy}
          size="lg"
        />
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  input: {
    marginTop: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
})
