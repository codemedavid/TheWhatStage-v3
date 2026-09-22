import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSendableActionPages } from '@/data/action-pages'
import { BUTTONS_MAX, type SavedButton } from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'
import { ButtonEditorSheet } from './button-editor-sheet'

const ICONS: Record<SavedButton['type'], keyof typeof Ionicons.glyphMap> = {
  url: 'link-outline',
  action_page: 'document-text-outline',
  phone: 'call-outline',
  postback: 'chatbubbles-outline',
}

interface Props {
  buttons: SavedButton[]
  onChange: (buttons: SavedButton[]) => void
  /** Shown on the add row; the wording differs on a card. */
  addLabel?: string
}

/**
 * The buttons riding under a message or a card: add, edit and remove, capped
 * at Messenger's three. Editing happens in a sheet so a row stays a summary.
 */
export function ButtonList({ buttons, onChange, addLabel = 'Add a button' }: Props) {
  // Only to name the page a button points at; the sheet does the picking.
  const pages = useSendableActionPages(buttons.some((button) => button.type === 'action_page'))
  const [editing, setEditing] = useState<number | null>(null)

  const describe = (button: SavedButton): string => {
    switch (button.type) {
      case 'url':
        return button.url || 'No link yet'
      case 'phone':
        return button.phone || 'No number yet'
      case 'postback':
        return button.reply ? `Bot answers: “${button.reply}”` : 'Nothing to say yet'
      case 'action_page': {
        const page = (pages.data ?? []).find((candidate) => candidate.id === button.action_page_id)
        if (page) return page.title
        return pages.isLoading ? 'Loading page…' : 'Page unavailable — pick another'
      }
    }
  }

  const replaceAt = (index: number, button: SavedButton) =>
    onChange(buttons.map((existing, at) => (at === index ? button : existing)))

  const removeAt = (index: number) => onChange(buttons.filter((_, at) => at !== index))

  const isNew = editing === buttons.length

  return (
    <View style={{ gap: 8 }}>
      {buttons.map((button, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={`Edit button ${button.label || index + 1}`}
          onPress={() => setEditing(index)}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.accentSubtle }]}
        >
          <View style={styles.icon}>
            <Ionicons name={ICONS[button.type]} size={15} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.bodyStrong} numberOfLines={1}>
              {button.label || 'Untitled button'}
            </Text>
            <Text style={type.caption} numberOfLines={1}>
              {describe(button)}
            </Text>
          </View>
          <Pressable
            onPress={() => removeAt(index)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove button ${button.label || index + 1}`}
          >
            <Ionicons name="close-circle" size={19} color={colors.faint} />
          </Pressable>
        </Pressable>
      ))}

      {buttons.length < BUTTONS_MAX ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing(buttons.length)}
          style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.accentSubtle }]}
        >
          <Ionicons name="add-circle-outline" size={17} color={colors.accent} />
          <Text style={styles.addText}>{addLabel}</Text>
        </Pressable>
      ) : (
        <Text style={type.caption}>Messenger allows {BUTTONS_MAX} buttons at most.</Text>
      )}

      <ButtonEditorSheet
        visible={editing !== null}
        button={editing !== null && !isNew ? buttons[editing] : null}
        onClose={() => setEditing(null)}
        onSave={(button) => {
          if (editing === null) return
          if (isNew) onChange([...buttons, button])
          else replaceAt(editing, button)
        }}
        onRemove={editing !== null && !isNew ? () => removeAt(editing) : undefined}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  addText: { fontSize: 14, fontWeight: '600', color: colors.accent },
})
