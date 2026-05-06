import type { WorkflowGraph, WorkflowTrigger } from './types'

export interface WorkflowTemplate {
  id: string
  name: string
  blurb: string
  trigger_kind: WorkflowTrigger['kind']
  build: () => { name: string; triggers: WorkflowTrigger[]; graph: WorkflowGraph }
}

// All templates ship with placeholder stage_id / action_page_id values; the
// user fills these in by selecting the trigger / set_stage node after the
// workflow is created. Send-node text is pre-filled with sane defaults that
// the user can edit.

const HUMAN_AGENT = { kind: 'workflow_human_agent' as const }

// ---------------------------------------------------------------------------
// 1. Stage idle → follow up
// ---------------------------------------------------------------------------
function stageIdleFollowup(): ReturnType<WorkflowTemplate['build']> {
  return {
    name: 'Stage idle → follow up',
    triggers: [{ kind: 'stage_idle', config: { min_idle_ms: 60 * 60 * 1000 } }],
    graph: {
      start_node_id: 'send-1',
      nodes: [
        { id: 'send-1', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Hey! Just checking in — still interested? Happy to answer any questions.' },
          } },
        { id: 'wait-1', type: 'wait_for_reply', config: { timeout_ms: 24 * 60 * 60 * 1000 } },
        { id: 'send-2', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Hi again — anything I can help with? Reply here and I\'ll get right back to you.' },
          } },
        { id: 'stop-1', type: 'stop', config: {} },
      ],
      edges: [
        { from: 'send-1', label: 'success',        to: 'wait-1' },
        { from: 'send-1', label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-1', label: 'error',          to: 'stop-1' },
        { from: 'wait-1', label: 'on_reply',       to: 'stop-1' },
        { from: 'wait-1', label: 'on_timeout',     to: 'send-2' },
        { from: 'send-2', label: 'success',        to: 'stop-1' },
        { from: 'send-2', label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-2', label: 'error',          to: 'stop-1' },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Stage entered → nudge if no reply
// ---------------------------------------------------------------------------
function stageEnteredNoReply(): ReturnType<WorkflowTemplate['build']> {
  return {
    name: 'Stage entered → nudge if no reply',
    triggers: [{ kind: 'stage_entered', config: {} }],
    graph: {
      start_node_id: 'wait-1',
      nodes: [
        { id: 'wait-1', type: 'wait', config: {
            duration_ms: 30 * 60 * 1000,
            interrupt_on: ['inbound_message'],
          } },
        { id: 'send-1', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Hi — wanted to make sure you saw my last message. Any questions I can clear up?' },
          } },
        { id: 'wait-2', type: 'wait_for_reply', config: { timeout_ms: 4 * 60 * 60 * 1000 } },
        { id: 'send-2', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Last check-in from me — let me know whenever you\'re ready.' },
          } },
        { id: 'stop-1', type: 'stop', config: {} },
      ],
      edges: [
        { from: 'wait-1', label: 'timeout',              to: 'send-1' },
        { from: 'wait-1', label: 'interrupted_inbound',  to: 'stop-1' },
        { from: 'send-1', label: 'success',              to: 'wait-2' },
        { from: 'send-1', label: 'policy_blocked',       to: 'stop-1' },
        { from: 'send-1', label: 'error',                to: 'stop-1' },
        { from: 'wait-2', label: 'on_reply',             to: 'stop-1' },
        { from: 'wait-2', label: 'on_timeout',           to: 'send-2' },
        { from: 'send-2', label: 'success',              to: 'stop-1' },
        { from: 'send-2', label: 'policy_blocked',       to: 'stop-1' },
        { from: 'send-2', label: 'error',                to: 'stop-1' },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// 3. Booking reminder ladder (2d / 20m / 5m before appointment)
// ---------------------------------------------------------------------------
function bookingReminderLadder(): ReturnType<WorkflowTemplate['build']> {
  // Three independent triggers — the dispatcher creates one run per offset,
  // and each run takes the matching branch via the if-node on `state.variables.offset`.
  return {
    name: 'Booking reminders (2d / 20m / 5m before)',
    triggers: [
      { kind: 'booking_offset', config: { offset: '-2d'  } },
      { kind: 'booking_offset', config: { offset: '-20m' } },
      { kind: 'booking_offset', config: { offset: '-5m'  } },
    ],
    graph: {
      start_node_id: 'if-offset',
      nodes: [
        { id: 'if-offset', type: 'if', config: {
            logic: 'OR',
            conditions: [{ kind: 'custom_field_eq', params: { field: 'offset', value: '-2d' } }],
          } },
        { id: 'send-2d',  type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Reminder: your appointment is in 2 days. Looking forward to it!' },
          } },
        { id: 'if-20m',   type: 'if', config: {
            logic: 'OR',
            conditions: [{ kind: 'custom_field_eq', params: { field: 'offset', value: '-20m' } }],
          } },
        { id: 'send-20m', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Heads up — your appointment starts in 20 minutes.' },
          } },
        { id: 'send-5m',  type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Starting in 5 minutes — see you shortly!' },
          } },
        { id: 'stop-1',   type: 'stop', config: {} },
      ],
      edges: [
        { from: 'if-offset', label: 'then',           to: 'send-2d' },
        { from: 'if-offset', label: 'else',           to: 'if-20m' },
        { from: 'if-20m',    label: 'then',           to: 'send-20m' },
        { from: 'if-20m',    label: 'else',           to: 'send-5m' },
        { from: 'send-2d',   label: 'success',        to: 'stop-1' },
        { from: 'send-2d',   label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-2d',   label: 'error',          to: 'stop-1' },
        { from: 'send-20m',  label: 'success',        to: 'stop-1' },
        { from: 'send-20m',  label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-20m',  label: 'error',          to: 'stop-1' },
        { from: 'send-5m',   label: 'success',        to: 'stop-1' },
        { from: 'send-5m',   label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-5m',   label: 'error',          to: 'stop-1' },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// 4. Form filled → nurture, advance stage on reply
// ---------------------------------------------------------------------------
function formFilledNurture(): ReturnType<WorkflowTemplate['build']> {
  return {
    name: 'Form filled → nurture',
    triggers: [{ kind: 'submission_received', config: {} }],
    graph: {
      start_node_id: 'send-1',
      nodes: [
        { id: 'send-1', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Thanks for filling that out! I\'ll review and follow up shortly.' },
          } },
        { id: 'wait-1', type: 'wait_for_reply', config: { timeout_ms: 24 * 60 * 60 * 1000 } },
        { id: 'set-1',  type: 'set_stage', config: { stage_id: '' } },
        { id: 'send-2', type: 'send', config: {
            ...HUMAN_AGENT,
            payload: { kind: 'text', text: 'Quick follow-up — did anything come up while reviewing?' },
          } },
        { id: 'wait-2', type: 'wait_for_reply', config: { timeout_ms: 48 * 60 * 60 * 1000 } },
        { id: 'set-2',  type: 'set_stage', config: { stage_id: '' } },
        { id: 'stop-1', type: 'stop', config: {} },
      ],
      edges: [
        { from: 'send-1', label: 'success',        to: 'wait-1' },
        { from: 'send-1', label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-1', label: 'error',          to: 'stop-1' },
        { from: 'wait-1', label: 'on_reply',       to: 'set-1' },
        { from: 'wait-1', label: 'on_timeout',     to: 'send-2' },
        { from: 'set-1',  label: 'then',           to: 'stop-1' },
        { from: 'send-2', label: 'success',        to: 'wait-2' },
        { from: 'send-2', label: 'policy_blocked', to: 'stop-1' },
        { from: 'send-2', label: 'error',          to: 'stop-1' },
        { from: 'wait-2', label: 'on_reply',       to: 'set-2' },
        { from: 'wait-2', label: 'on_timeout',     to: 'stop-1' },
        { from: 'set-2',  label: 'then',           to: 'stop-1' },
      ],
    },
  }
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'stage-idle-followup',
    name: 'Stage idle → follow up',
    blurb: 'When a lead sits idle in a stage, send a follow-up. End the run if they reply.',
    trigger_kind: 'stage_idle',
    build: stageIdleFollowup,
  },
  {
    id: 'stage-entered-no-reply',
    name: 'Stage entered → nudge if no reply',
    blurb: 'After a lead enters a stage, wait. Nudge if they haven\'t replied; nudge once more on timeout.',
    trigger_kind: 'stage_entered',
    build: stageEnteredNoReply,
  },
  {
    id: 'booking-reminder-ladder',
    name: 'Booking reminders (2d / 20m / 5m)',
    blurb: 'Send appointment reminders 2 days, 20 minutes, and 5 minutes before the booked time.',
    trigger_kind: 'booking_offset',
    build: bookingReminderLadder,
  },
  {
    id: 'form-filled-nurture',
    name: 'Form filled → nurture & advance',
    blurb: 'Thank the lead after a form submission, follow up if quiet, advance their stage on reply.',
    trigger_kind: 'submission_received',
    build: formFilledNurture,
  },
]
