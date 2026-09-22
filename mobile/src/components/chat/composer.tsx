import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useCallback, useImperativeHandle, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Sheet } from '@/components/ui/sheet'
import { savedMessagePreview } from '@/data/saved-messages'
import type { SavedMessage } from '@/data/types'
import { previewPersonalize, truncate } from '@/lib/format'
import { describeLayout, textMaxFor, usesCards } from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'

export const MESSAGE_MAX = 2000
const QUICK_LIMIT = 6
const LINE_HEIGHT = 21
const MAX_LINES = 5

/** Imperative handle so the picker sheet can load a saved message into the box. */
export interface ComposerHandle {
  load: (message: SavedMessage) => void
}

export interface ComposerSubmit {
  text: string
  /**
   * Set when the send should go out as a saved message — with whatever buttons
   * or cards it carries. `text` is then the operator's edit of its body, and is
   * ignored for card layouts, which hold their copy inside the cards.
   */
  saved: SavedMessage | null
}

interface Props {
  disabled?: boolean
  disabledNote?: string
  saved: SavedMessage[]
  leadName?: string | null
  ref?: React.Ref<ComposerHandle>
  onSend: (submit: ComposerSubmit) => void
  onOpenSaved: () => void
  onOpenActionPages: () => void
  onOpenMedia: () => void
}

export function Composer({
  disabled,
  disabledNote,
  saved,
  leadName,
  ref,
  onSend,
  onOpenSaved,
  onOpenActionPages,
  onOpenMedia,
}: Props) {
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<SavedMessage | null>(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [height, setHeight] = useState(LINE_HEIGHT)

  // A card message has no editable body — its copy lives in the cards — so the
  // text box steps aside and the chip is what gets sent.
  const cardsOnly = !!attached && usesCards(attached.layout)
  // Messenger's button template caps its text well below a plain message.
  const maxLength = textMaxFor(attached?.layout ?? 'text')

  // "/" at the start filters the quick strip by shortcut.
  const quick = useMemo(() => {
    if (text.startsWith('/')) {
      const q = text.slice(1).toLowerCase()
      return saved.filter((m) => m.shortcut?.startsWith(q)).slice(0, QUICK_LIMIT)
    }
    return saved.slice(0, QUICK_LIMIT)
  }, [saved, text])

  const insertSaved = useCallback(
    (m: SavedMessage) => {
      Haptics.selectionAsync().catch(() => {})
      setAttached(m)
      setText(usesCards(m.layout) ? '' : previewPersonalize(m.body, leadName).slice(0, textMaxFor(m.layout)))
    },
    [leadName],
  )

  // The picker sheet loads its choice here rather than sending straight away,
  // so a button message can still be edited before it goes out.
  useImperativeHandle(ref, () => ({ load: insertSaved }), [insertSaved])

  // Deliberately NOT gated on an in-flight send: the optimistic bubble already
  // shows "Sending…", so locking the input just makes a slow network feel like
  // a frozen app. Sends are independent, so firing several back-to-back is fine.
  const canSend = !disabled && (text.trim().length > 0 || cardsOnly)

  const submit = () => {
    if (!canSend) return
    onSend({ text: text.trim(), saved: attached })
    setText('')
    setAttached(null)
    setHeight(LINE_HEIGHT)
  }

  if (disabled) {
    return (
      <View style={styles.disabled}>
        <Ionicons name="link-outline" size={16} color={colors.tertiary} />
        <Text style={type.small}>{disabledNote ?? 'Replies are unavailable for this chat.'}</Text>
      </View>
    )
  }

  return (
    <View style={styles.wrap}>
      {quick.length > 0 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {quick.map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              onPress={() => insertSaved(m)}
              style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={m.layout === 'text' ? 'bookmark' : 'link'} size={11} color={colors.accent} />
              <Text style={styles.quickText} numberOfLines={1}>
                {m.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {attached && attached.layout !== 'text' && (
        <View style={styles.attachment}>
          <Ionicons name={cardsOnly ? 'albums' : 'radio-button-on'} size={14} color={colors.accentDeep} />
          <Text style={styles.attachmentText} numberOfLines={1}>
            {describeLayout(attached)} ·{' '}
            {cardsOnly ? truncate(savedMessagePreview(attached), 40) : attached.title}
          </Text>
          <Pressable
            onPress={() => setAttached(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send as plain text instead"
          >
            <Ionicons name="close" size={14} color={colors.accentDeep} />
          </Pressable>
        </View>
      )}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More options"
          onPress={() => setPlusOpen(true)}
          style={styles.plus}
        >
          <Ionicons name="add" size={24} color={colors.accent} />
        </Pressable>
        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { height: Math.min(height, LINE_HEIGHT * MAX_LINES) + 18 }]}
            value={text}
            editable={!cardsOnly}
            onChangeText={(t) => setText(t.slice(0, maxLength))}
            onContentSizeChange={(e) => setHeight(Math.max(LINE_HEIGHT, e.nativeEvent.contentSize.height))}
            multiline
            placeholder={cardsOnly ? 'Tap send to deliver the cards' : 'Message…'}
            placeholderTextColor={colors.muted}
            accessibilityLabel="Message"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={submit}
          style={({ pressed }) => [styles.send, !canSend && styles.sendOff, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="paper-plane" size={18} color="#fff" style={{ marginLeft: -2, marginTop: 1 }} />
        </Pressable>
      </View>

      <Sheet visible={plusOpen} onClose={() => setPlusOpen(false)} title="Add to message">
        <View style={{ gap: 8, paddingBottom: spacing.sm }}>
          <PlusOption
            icon="bookmark-outline"
            title="Saved messages"
            body="Insert a reply you use often"
            onPress={() => {
              setPlusOpen(false)
              onOpenSaved()
            }}
          />
          <PlusOption
            icon="images-outline"
            title="Media"
            body="Send a photo, video, or voice note from your library"
            onPress={() => {
              setPlusOpen(false)
              onOpenMedia()
            }}
          />
          <PlusOption
            icon="link-outline"
            title="Action pages"
            body="Send a form, booking, or order page as a button"
            onPress={() => {
              setPlusOpen(false)
              onOpenActionPages()
            }}
          />
        </View>
      </Sheet>
    </View>
  )
}

function PlusOption({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.accentSubtle }]}
    >
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong}>{title}</Text>
        <Text style={type.small}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: 6,
  },
  strip: { gap: 6, paddingHorizontal: 4, paddingBottom: 6 },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 4,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accentLight,
  },
  attachmentText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.accentDeep },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentLight,
    maxWidth: 160,
  },
  quickText: { fontSize: 12, fontWeight: '600', color: colors.accentDeep },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingBottom: 6 },
  plus: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1,
    backgroundColor: colors.borderSubtle,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  input: { fontSize: 16, color: colors.ink, lineHeight: LINE_HEIGHT, paddingTop: 9, paddingBottom: 9 },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: colors.faint },
  disabled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
