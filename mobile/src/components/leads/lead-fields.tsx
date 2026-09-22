import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Card, Pill, Row, SectionLabel } from '@/components/ui/primitives'
import type { LeadFieldDef, LeadRow } from '@/data/types'
import { colors, radius, spacing, type } from '@/theme/tokens'

export type ContactKey = 'email' | 'phone' | 'company' | 'job_title' | 'notes'

export const CONTACT_FIELDS: { key: ContactKey; label: string; icon: keyof typeof Ionicons.glyphMap; multiline?: boolean }[] = [
  { key: 'email', label: 'Email', icon: 'mail-outline' },
  { key: 'phone', label: 'Phone', icon: 'call-outline' },
  { key: 'company', label: 'Company', icon: 'business-outline' },
  { key: 'job_title', label: 'Job title', icon: 'briefcase-outline' },
  { key: 'notes', label: 'Notes', icon: 'document-text-outline', multiline: true },
]

export interface FieldDraft {
  contact: Record<ContactKey, string>
  custom: Record<string, unknown>
}

export function draftFromLead(lead: LeadRow): FieldDraft {
  return {
    contact: {
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      company: lead.company ?? '',
      job_title: lead.job_title ?? '',
      notes: lead.notes ?? '',
    },
    custom: { ...(lead.custom_fields ?? {}) },
  }
}

interface SelectOption {
  value: string
  label: string
}

/** options may be ["a","b"] or [{value,label}] — normalise defensively. */
export function selectOptions(raw: unknown): SelectOption[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((o): SelectOption[] => {
    if (typeof o === 'string') return [{ value: o, label: o }]
    if (o && typeof o === 'object' && 'value' in o) {
      const v = String((o as { value: unknown }).value)
      const l = 'label' in o ? String((o as { label: unknown }).label ?? v) : v
      return [{ value: v, label: l }]
    }
    return []
  })
}

interface Props {
  lead: LeadRow
  defs: LeadFieldDef[]
  editing: boolean
  draft: FieldDraft
  onChange: (next: FieldDraft) => void
}

export function LeadFields({ lead, defs, editing, draft, onChange }: Props) {
  const setContact = (key: ContactKey, value: string) =>
    onChange({ ...draft, contact: { ...draft.contact, [key]: value } })
  const setCustom = (key: string, value: unknown) =>
    onChange({ ...draft, custom: { ...draft.custom, [key]: value } })

  return (
    <View>
      <SectionLabel>Contact</SectionLabel>
      <Card style={{ paddingVertical: 4 }}>
        {CONTACT_FIELDS.map((f) =>
          editing ? (
            <View key={f.key} style={styles.editRow}>
              <Ionicons name={f.icon} size={18} color={colors.tertiary} style={{ width: 24, marginTop: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={type.caption}>{f.label}</Text>
                <TextInput
                  style={[styles.input, f.multiline && styles.multiline]}
                  value={draft.contact[f.key]}
                  onChangeText={(v) => setContact(f.key, v)}
                  placeholder={f.label}
                  placeholderTextColor={colors.muted}
                  multiline={f.multiline}
                  autoCapitalize={f.key === 'email' ? 'none' : 'sentences'}
                  keyboardType={f.key === 'email' ? 'email-address' : f.key === 'phone' ? 'phone-pad' : 'default'}
                />
              </View>
            </View>
          ) : (
            <Row key={f.key} icon={f.icon} label={f.label} value={lead[f.key]} />
          ),
        )}
        {!editing && lead.source ? <Row icon="compass-outline" label="Source" value={lead.source} /> : null}
      </Card>

      {defs.length > 0 && (
        <>
          <SectionLabel>Custom fields</SectionLabel>
          <Card style={{ paddingVertical: 4 }}>
            {defs.map((d) => (
              <CustomField
                key={d.id}
                def={d}
                value={editing ? draft.custom[d.key] : lead.custom_fields?.[d.key]}
                editing={editing}
                onChange={(v) => setCustom(d.key, v)}
              />
            ))}
          </Card>
        </>
      )}
    </View>
  )
}

function CustomField({
  def,
  value,
  editing,
  onChange,
}: {
  def: LeadFieldDef
  value: unknown
  editing: boolean
  onChange: (v: unknown) => void
}) {
  const display = value == null || value === '' ? null : String(value)
  if (!editing) return <Row label={def.label} value={display} />

  if (def.type === 'select') {
    const options = selectOptions(def.options)
    return (
      <View style={styles.editRow}>
        <View style={{ flex: 1 }}>
          <Text style={type.caption}>{def.label}</Text>
          <View style={styles.pills}>
            {options.map((o) => (
              <Pill
                key={o.value}
                label={o.label}
                active={display === o.value}
                onPress={() => onChange(display === o.value ? null : o.value)}
              />
            ))}
            {options.length === 0 && <Text style={type.small}>No options defined</Text>}
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.editRow}>
      <View style={{ flex: 1 }}>
        <Text style={type.caption}>{def.label}</Text>
        <TextInput
          style={styles.input}
          value={display ?? ''}
          onChangeText={(v) => {
            if (def.type === 'number') {
              const n = v.trim() === '' ? null : Number(v)
              onChange(n == null || Number.isNaN(n) ? v : n)
              return
            }
            onChange(v)
          }}
          placeholder={def.type === 'date' ? 'YYYY-MM-DD' : def.label}
          placeholderTextColor={colors.muted}
          keyboardType={def.type === 'number' ? 'decimal-pad' : 'default'}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  editRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: 8 },
  input: {
    marginTop: 4,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
})
