import { StyleSheet, Text, View } from 'react-native'
import { colors, type } from '@/theme/tokens'

interface Props {
  label: string
  /** Right-aligned note — usually a character count. */
  hint?: string
  hintTone?: 'muted' | 'danger'
  children: React.ReactNode
}

/** A labelled block in the saved-message editor: heading, optional hint, field. */
export function Field({ label, hint, hintTone = 'muted', children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={type.label}>{label}</Text>
        {hint ? (
          <Text style={[type.caption, hintTone === 'danger' && { color: colors.danger }]}>{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
