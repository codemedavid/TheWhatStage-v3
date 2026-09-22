import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { KIND_ICON } from '@/components/submissions/page-stat-card'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import { useSendableActionPages } from '@/data/action-pages'
import {
  LABEL_MAX,
  REPLY_MAX,
  emptyButton,
  validateButton,
  type SavedButton,
  type SavedButtonAction,
} from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'
import { Field } from './field'

interface ActionOption {
  action: SavedButtonAction
  icon: keyof typeof Ionicons.glyphMap
  label: string
  /** What tapping the button does, in the customer's terms. */
  effect: string
}

const ACTIONS: ActionOption[] = [
  { action: 'url', icon: 'link-outline', label: 'Link', effect: 'Opens a web page.' },
  {
    action: 'action_page',
    icon: 'document-text-outline',
    label: 'Page',
    effect: 'Opens one of your action pages, signed for whoever you send it to.',
  },
  { action: 'phone', icon: 'call-outline', label: 'Call', effect: 'Dials your number.' },
  {
    action: 'postback',
    icon: 'chatbubbles-outline',
    label: 'Bot reply',
    effect: 'Reads as if the customer sent a message, and your bot answers it.',
  },
]

interface Props {
  visible: boolean
  /** The button being edited, or null to build a new one. */
  button: SavedButton | null
  onClose: () => void
  onSave: (button: SavedButton) => void
  onRemove?: () => void
}

/**
 * Edits one button end to end: what it does, what it says, and where it points.
 * Action pages are listed inline rather than behind a second sheet — stacking
 * modals is fragile on Android and this list is short.
 */
export function ButtonEditorSheet({ visible, button, onClose, onSave, onRemove }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title={button ? 'Edit button' : 'Add button'} height={0.85}>
      {/* Mounted per opening, so the draft starts from the button that was
          tapped without an effect copying props into state. */}
      {visible ? <ButtonForm button={button} onClose={onClose} onSave={onSave} onRemove={onRemove} /> : null}
    </Sheet>
  )
}

function ButtonForm({ button, onClose, onSave, onRemove }: Omit<Props, 'visible'>) {
  const [draft, setDraft] = useState<SavedButton>(() => button ?? emptyButton('url'))
  const [error, setError] = useState<string | null>(null)
  const pages = useSendableActionPages(draft.type === 'action_page')

  /** Switching action keeps the label; the old target no longer applies. */
  const changeAction = (action: SavedButtonAction) => {
    if (action === draft.type) return
    setDraft({ ...emptyButton(action), label: draft.label })
    setError(null)
  }

  const save = () => {
    const problem = validateButton(draft)
    if (problem) {
      setError(problem)
      return
    }
    onSave(draft)
    onClose()
  }

  const active = ACTIONS.find((option) => option.action === draft.type)

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <View style={{ gap: 6 }}>
        <View style={styles.actions}>
          {ACTIONS.map((option) => {
            const selected = option.action === draft.type
            return (
              <Pressable
                key={option.action}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                onPress={() => changeAction(option.action)}
                style={({ pressed }) => [styles.action, selected && styles.actionOn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name={option.icon} size={16} color={selected ? colors.accentDeep : colors.tertiary} />
                <Text style={[styles.actionText, selected && { color: colors.accentDeep }]}>{option.label}</Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={type.caption}>{active?.effect}</Text>
      </View>

      <Field label="Button text" hint={`${draft.label.length}/${LABEL_MAX}`}>
        <TextInput
          style={styles.input}
          value={draft.label}
          onChangeText={(text) => setDraft({ ...draft, label: text.slice(0, LABEL_MAX) })}
          placeholder="e.g. See pricing"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Button text"
        />
      </Field>

      {draft.type === 'url' && (
        <Field label="Link">
          <TextInput
            style={styles.input}
            value={draft.url}
            onChangeText={(url) => setDraft({ ...draft, url })}
            placeholder="https://"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            accessibilityLabel="Link"
          />
        </Field>
      )}

      {draft.type === 'phone' && (
        <Field label="Phone number">
          <TextInput
            style={styles.input}
            value={draft.phone}
            onChangeText={(phone) => setDraft({ ...draft, phone })}
            placeholder="+63 917 123 4567"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            accessibilityLabel="Phone number"
          />
        </Field>
      )}

      {draft.type === 'postback' && (
        <Field label="What this tells the bot" hint={`${draft.reply.length}/${REPLY_MAX}`}>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={draft.reply}
            onChangeText={(reply) => setDraft({ ...draft, reply: reply.slice(0, REPLY_MAX) })}
            placeholder="I'd like to see the price list"
            placeholderTextColor={colors.muted}
            multiline
            accessibilityLabel="What this tells the bot"
          />
        </Field>
      )}

      {draft.type === 'action_page' && (
        <Field label="Action page" hint="Published pages only">
          {pages.isLoading ? (
            <View style={{ gap: 8 }}>
              <Skeleton height={54} />
              <Skeleton height={54} />
            </View>
          ) : (pages.data ?? []).length === 0 ? (
            <EmptyState
              icon="link-outline"
              title="No published pages"
              body="Publish a form, booking, or order page in the dashboard and it will show up here."
            />
          ) : (
            <View style={{ gap: 8 }}>
              {(pages.data ?? []).map((page) => {
                const selected = page.id === draft.action_page_id
                return (
                  <Pressable
                    key={page.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() =>
                      setDraft({
                        type: 'action_page',
                        action_page_id: page.id,
                        // First pick seeds the label from the page's own CTA.
                        label: draft.label || (page.cta_label ?? 'Open').slice(0, LABEL_MAX),
                      })
                    }
                    style={({ pressed }) => [styles.page, selected && styles.pageOn, pressed && { opacity: 0.85 }]}
                  >
                    <Ionicons name={KIND_ICON[page.kind] ?? 'link-outline'} size={17} color={colors.accent} />
                    <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={1}>
                      {page.title}
                    </Text>
                    {selected ? <Ionicons name="checkmark-circle" size={19} color={colors.accent} /> : null}
                  </Pressable>
                )
              })}
            </View>
          )}
        </Field>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label={button ? 'Save button' : 'Add button'} onPress={save} size="lg" />
      {onRemove ? (
        <Button
          label="Remove button"
          variant="danger"
          onPress={() => {
            onRemove()
            onClose()
          }}
        />
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, paddingBottom: spacing.xl },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  actionOn: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  actionText: { fontSize: 13, fontWeight: '600', color: colors.tertiary },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 84, textAlignVertical: 'top', lineHeight: 21 },
  page: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  pageOn: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  error: { ...type.small, color: colors.danger },
})
