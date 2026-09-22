import { useEffect, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from 'react-native'

/**
 * A `KeyboardAvoidingView` that actually avoids the keyboard on Android.
 *
 * The usual `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` recipe
 * leaves Android with no behaviour at all, on the assumption that the OS
 * shrinks the window itself under `adjustResize`. From Expo SDK 54 edge-to-edge
 * is mandatory on Android, so the window keeps its full height and the keyboard
 * just covers whatever is at the bottom — the input you are typing into.
 * Setting a behaviour on both platforms makes the view move itself.
 *
 * `padding` is safe on a window that does resize too: the view re-measures on
 * layout, sees it no longer overlaps the keyboard, and drops the padding back
 * to zero rather than double-counting it.
 *
 * Mount it as the screen's outermost view (or at least as a child of one that
 * starts at the top of the window) — it compares its own frame against screen
 * coordinates, so a parent that is already inset reports the overlap short.
 */
export function KeyboardView({ behavior = 'padding', ...props }: KeyboardAvoidingViewProps) {
  return <KeyboardAvoidingView behavior={behavior} {...props} />
}

const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

/**
 * Whether the software keyboard is on screen. Use it to collapse bottom safe
 * area padding while the keyboard is up: the keyboard already covers the home
 * indicator / gesture bar, so keeping that padding only opens a dead gap
 * between the input and the keyboard.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible())

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, () => setVisible(true))
    const hide = Keyboard.addListener(HIDE_EVENT, () => setVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return visible
}
