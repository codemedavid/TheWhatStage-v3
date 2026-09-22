import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ButtonList } from '@/components/saved/button-list'
import { CardList } from '@/components/saved/card-list'
import { Field } from '@/components/saved/field'
import { LayoutPicker } from '@/components/saved/layout-picker'
import { SavedMessagePreview } from '@/components/saved/saved-message-preview'
import { Button } from '@/components/ui/button'
import { KeyboardView } from '@/components/ui/keyboard-view'
import { Skeleton } from '@/components/ui/primitives'
import { ScreenHeader } from '@/components/ui/screen-header'
import {
  SAVED_TITLE_MAX,
  normalizeShortcut,
  useDeleteSavedMessage,
  useSavedMessage,
  useSavedMessages,
  useUpsertSavedMessage,
} from '@/data/saved-messages'
import type { SavedMessage } from '@/data/types'
import {
  emptyCard,
  maxCardsFor,
  textMaxFor,
  usesCards,
  validateSavedMessage,
  type SavedButton,
  type SavedCard,
  type SavedLayout,
} from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'

const MERGE_TAGS = [
  { tag: '[first_name]', label: 'First name' },
  { tag: '[name]', label: 'Full name' },
  { tag: '[last_name]', label: 'Last name' },
]
const SHORTCUT_MAX = 24

interface Draft {
  title: string
  body: string
  shortcut: string
  layout: SavedLayout
  buttons: SavedButton[]
  cards: SavedCard[]
}

const EMPTY: Draft = { title: '', body: '', shortcut: '', layout: 'text', buttons: [], cards: [] }

function draftFrom(row: SavedMessage): Draft {
  return {
    title: row.title,
    body: row.body,
    shortcut: row.shortcut ?? '',
    layout: row.layout,
    buttons: row.buttons,
    cards: row.cards,
  }
}

/**
 * Switching layout keeps everything the new layout can still use: the buttons
 * an operator already wrote survive a trip through a card layout, and a
 * carousel narrowed to a single card keeps the first one rather than none.
 */
function withLayout(draft: Draft, layout: SavedLayout): Draft {
  const cards = usesCards(layout)
    ? (draft.cards.length ? draft.cards : [emptyCard()]).slice(0, maxCardsFor(layout))
    : draft.cards
  return { ...draft, layout, cards, body: draft.body.slice(0, textMaxFor(layout)) }
}

/**
 * Full-screen saved-message editor. A sheet was too cramped for a multi-line
 * body plus buttons, and the keyboard covered the save action — here the
 * preview stays visible while typing and every field has room to breathe.
 *
 * Route param `id` is a saved-message id, or `new`.
 */
export default function SavedMessageEditor() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const isNew = !id || id === 'new'

  const existing = useSavedMessage(isNew ? null : id)
  const all = useSavedMessages()
  const upsert = useUpsertSavedMessage()
  const remove = useDeleteSavedMessage()

  // `edited` stays null until the operator touches something, so the stored row
  // is simply rendered — and a background refetch can never stomp on typing.
  const [edited, setEdited] = useState<Draft | null>(isNew ? EMPTY : null)
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const stored = useMemo(() => (existing.data ? draftFrom(existing.data) : null), [existing.data])
  const draft = edited ?? stored ?? EMPTY
  const loaded = isNew || !!stored

  const patch = (next: Partial<Draft>) => setEdited({ ...draft, ...next })

  const onCards = usesCards(draft.layout)
  const bodyMax = textMaxFor(draft.layout)
  const shortcut = normalizeShortcut(draft.shortcut)

  const shortcutTaken = useMemo(() => {
    if (!shortcut) return false
    return (all.data ?? []).some((m) => m.shortcut === shortcut && m.id !== id)
  }, [all.data, shortcut, id])

  // The same validator the save path and the server use, surfaced inline so a
  // half-built message explains itself before the operator taps Save.
  const problem = validateSavedMessage({
    layout: draft.layout,
    body: draft.body,
    buttons: draft.buttons,
    cards: draft.cards,
  })
  const canSave = !!draft.title.trim() && !problem && !shortcutTaken

  const insertTag = (tag: string) => {
    Haptics.selectionAsync().catch(() => {})
    const at = Math.min(cursor, draft.body.length)
    const next = `${draft.body.slice(0, at)}${tag}${draft.body.slice(at)}`
    patch({ body: next })
    setCursor(at + tag.length)
  }

  const save = async () => {
    if (!canSave) return
    setError(null)
    try {
      await upsert.mutateAsync({
        id: isNew ? undefined : id,
        title: draft.title,
        body: draft.body,
        shortcut: draft.shortcut,
        layout: draft.layout,
        buttons: draft.buttons,
        cards: draft.cards,
      })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/saved-messages'))

  const confirmDelete = () => {
    if (isNew) return
    Alert.alert('Delete saved message?', `"${draft.title}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await remove.mutateAsync(id)
          close()
        },
      },
    ])
  }

  return (
    <KeyboardView style={styles.screen}>
      <ScreenHeader
        back
        title={isNew ? 'New saved message' : 'Edit saved message'}
        right={
          <Pressable onPress={save} disabled={!canSave || upsert.isPending} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.save, (!canSave || upsert.isPending) && { color: colors.faint }]}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        }
      />

      {!loaded ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={90} />
          <Skeleton height={44} />
          <Skeleton height={120} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        >
          <SavedMessagePreview
            layout={draft.layout}
            body={draft.body}
            buttons={draft.buttons}
            cards={draft.cards}
          />

          <Field label="Title" hint={`${draft.title.length}/${SAVED_TITLE_MAX}`}>
            <TextInput
              style={styles.input}
              value={draft.title}
              onChangeText={(t) => patch({ title: t.slice(0, SAVED_TITLE_MAX) })}
              placeholder="e.g. Pricing overview"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Title"
            />
            <Text style={styles.hint}>Only you see this — it names the message in your list.</Text>
          </Field>

          <Field label="Send as">
            <LayoutPicker value={draft.layout} onChange={(layout) => patch(withLayout(draft, layout))} />
          </Field>

          {!onCards && (
            <Field
              label="Message"
              hint={`${draft.body.length}/${bodyMax}`}
              hintTone={draft.body.trim().length > bodyMax ? 'danger' : 'muted'}
            >
              <TextInput
                style={[styles.input, styles.multiline]}
                value={draft.body}
                onChangeText={(t) => patch({ body: t })}
                onSelectionChange={(e) => setCursor(e.nativeEvent.selection.start)}
                placeholder="Hi [first_name], here's what we offer…"
                placeholderTextColor={colors.muted}
                multiline
                accessibilityLabel="Message"
              />
              <View style={styles.tagRow}>
                {MERGE_TAGS.map((t) => (
                  <Pressable
                    key={t.tag}
                    accessibilityRole="button"
                    accessibilityLabel={`Insert ${t.label}`}
                    onPress={() => insertTag(t.tag)}
                    style={({ pressed }) => [styles.tag, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="add" size={12} color={colors.accentDeep} />
                    <Text style={styles.tagText}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
          )}

          {draft.layout === 'buttons' && (
            <Field label="Buttons" hint={`${draft.buttons.length}/3`}>
              <ButtonList buttons={draft.buttons} onChange={(buttons) => patch({ buttons })} />
            </Field>
          )}

          {onCards && (
            <Field
              label={draft.layout === 'carousel' ? 'Cards' : 'Card'}
              hint={draft.layout === 'carousel' ? `${draft.cards.length}/${maxCardsFor('carousel')}` : undefined}
            >
              <CardList
                layout={draft.layout === 'carousel' ? 'carousel' : 'card'}
                cards={draft.cards}
                onChange={(cards) => patch({ cards })}
              />
            </Field>
          )}

          <Field label="Shortcut" hint="Optional">
            <View style={styles.shortcutRow}>
              <Text style={styles.slash}>/</Text>
              <TextInput
                style={[styles.input, { flex: 1, paddingLeft: 22 }, shortcutTaken && styles.inputError]}
                value={draft.shortcut}
                onChangeText={(t) =>
                  patch({ shortcut: t.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, SHORTCUT_MAX) })
                }
                placeholder="pricing"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Shortcut"
              />
            </View>
            <Text style={shortcutTaken ? styles.error : styles.hint}>
              {shortcutTaken
                ? 'Another saved message already uses that shortcut.'
                : shortcut
                  ? `Type /${shortcut} in a chat to pull this up.`
                  : 'Type / in a chat to filter saved messages by shortcut.'}
            </Text>
          </Field>

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : problem && draft.title.trim() ? (
            <Text style={styles.hint}>{problem}</Text>
          ) : null}

          <Button
            label={isNew ? 'Save message' : 'Save changes'}
            onPress={save}
            disabled={!canSave}
            loading={upsert.isPending}
            size="lg"
          />

          {!isNew && (
            <Button
              label="Delete saved message"
              variant="danger"
              onPress={confirmDelete}
              loading={remove.isPending}
            />
          )}
        </ScrollView>
      )}
    </KeyboardView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.lg, gap: spacing.xl },
  save: { color: colors.accent, fontWeight: '700', fontSize: 16 },
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
  inputError: { borderColor: colors.danger },
  multiline: { minHeight: 132, textAlignVertical: 'top', lineHeight: 21 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.accentLight,
  },
  tagText: { fontSize: 12, fontWeight: '600', color: colors.accentDeep },
  shortcutRow: { position: 'relative', justifyContent: 'center' },
  slash: { position: 'absolute', left: 12, zIndex: 1, color: colors.muted, fontSize: 15 },
  hint: { ...type.caption },
  error: { ...type.small, color: colors.danger },
})
