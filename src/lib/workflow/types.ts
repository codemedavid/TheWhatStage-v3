export type NodeType =
  | 'send'
  | 'set_stage'
  | 'wait'
  | 'wait_for_reply'
  | 'if'
  | 'classify_and_route'
  | 'request_marketing_optin'
  | 'request_otn'
  | 'stop'

export interface WorkflowNode {
  id: string
  type: NodeType
  config: Record<string, unknown>
}

export interface WorkflowEdge {
  from: string
  /** 'success'|'policy_blocked'|'error'|'then'|'else'|'timeout'|'on_reply'|'interrupted_inbound'|... */
  label: string
  to: string
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  start_node_id: string
}

export interface WorkflowTrigger {
  kind: 'stage_entered' | 'stage_idle' | 'submission_received' | 'booking_offset' | 'cart_abandoned'
  config: Record<string, unknown>
}

export interface SendNodeConfig {
  payload:
    | { kind: 'text'; text: string }
    | { kind: 'button'; text: string; url: string; ctaLabel: string }
    | {
        kind: 'utility_template'
        /** messenger_message_templates.id */
        template_id: string
        /**
         * 1-based variable map keyed by '1', '2', ... matching the
         * {{1}}, {{2}}, ... placeholders in the template body.
         */
        variables: Record<
          string,
          | { kind: 'static'; text: string }
          | { kind: 'lead_field'; field: string }
          | { kind: 'booking_field'; field: 'event_at' | 'event_at_relative' | 'title' }
          | { kind: 'property_field'; field: 'title' | 'address' | 'price' | 'deeplink_url' }
        >
        /** Optional override for the template's URL button. Defaults to action page deeplink. */
        button_url_override?: string | null
        /** Index of the button to override; null = first URL button. */
        button_index?: number | null
      }
  /**
   * Channel hint forwarded to sendOutbound.
   * - 'bot'                  — only sends inside the 24h window; pauses otherwise.
   * - 'workflow_human_agent' — uses Messenger HUMAN_AGENT tag (7-day window).
   *   Default for new workflow send nodes; keep messages human-reviewable.
   * - 'submission_echo'      — confirmation echo after a form submission.
   */
  kind?: 'bot' | 'workflow_human_agent' | 'submission_echo'
}

export interface SetStageNodeConfig {
  stage_id: string
}

export interface WaitNodeConfig {
  /** milliseconds to wait (positive int) */
  duration_ms?: number
  /** ISO timestamp for absolute wait */
  until?: string
  interrupt_on?: Array<'inbound_message' | 'stage_changed' | 'submission_received'>
}

export interface WaitForReplyNodeConfig {
  /** milliseconds until timeout edge fires */
  timeout_ms: number
}

export interface RequestMarketingOptinConfig {
  message: string
  timeout_ms: number
}

export interface RequestOtnConfig {
  topic: string
  message: string
  timeout_ms: number
}

export interface IfCondition {
  kind: 'in_stage' | 'replied_within' | 'submission_outcome_is' | 'custom_field_eq'
  params: Record<string, unknown>
}

export interface IfNodeConfig {
  conditions: IfCondition[]
  logic: 'AND' | 'OR'
}

export interface WorkflowRunState {
  variables: Record<string, unknown>
  waiting_for?: 'timeout' | 'inbound_message' | 'stage_changed' | 'submission_received' | 'window' | 'optin' | 'otn'
  interrupt_on?: Array<'inbound_message' | 'stage_changed' | 'submission_received'>
  // Set by interruptWorkflowRun() before re-enqueuing the job.
  // Cleared by the executor after handling.
  interrupt_event?: {
    kind: 'inbound_message' | 'otn_granted' | 'timeout'
    body?: string
    fb_message_id?: string | null
    otn_token?: string
  }
}

// Cart-abandoned trigger config
export interface CartAbandonedTriggerConfig {
  // Minimum time (ms) a cart must be idle before it's considered abandoned.
  // Default: 30 minutes.
  min_idle_ms?: number
  // Optional: only fire for carts from this source (e.g. 'messenger_bot')
  source?: string
}
