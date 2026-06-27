import { describe, expect, it } from 'vitest'
import { projectRpcArgs, rpcArgs } from './rpc-args'

describe('rpcArgs (base / lead-side)', () => {
  it('maps the four cohort filters, defaulting absent ones to null', () => {
    expect(rpcArgs({})).toEqual({
      p_from: null,
      p_to: null,
      p_source: null,
      p_campaign: null,
    })
  })

  it('never includes p_workspace_id (lead-side RPCs are account-wide)', () => {
    expect(rpcArgs({ workspace: 'ws-1' })).not.toHaveProperty('p_workspace_id')
  })

  it('passes through provided filter values', () => {
    expect(rpcArgs({ from: '2026-06-01', to: '2026-06-26', source: 'fb', campaign: 'c1' })).toEqual({
      p_from: '2026-06-01',
      p_to: '2026-06-26',
      p_source: 'fb',
      p_campaign: 'c1',
    })
  })
})

describe('projectRpcArgs (project-side)', () => {
  it('adds p_workspace_id = null when no workspace is selected (all workspaces)', () => {
    expect(projectRpcArgs({})).toEqual({
      p_from: null,
      p_to: null,
      p_source: null,
      p_campaign: null,
      p_workspace_id: null,
    })
  })

  it('scopes to the selected workspace', () => {
    expect(projectRpcArgs({ workspace: 'ws-42' }).p_workspace_id).toBe('ws-42')
  })

  it('preserves the base cohort filters alongside the workspace scope', () => {
    expect(projectRpcArgs({ source: 'ig', workspace: 'ws-1' })).toMatchObject({
      p_source: 'ig',
      p_workspace_id: 'ws-1',
    })
  })
})
