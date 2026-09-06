'use client'

import { useState, useTransition } from 'react'
import { createApiKey, revokeApiKey } from '../actions'

export interface ApiKeyListItem {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface ApiKeysPanelProps {
  keys: ApiKeyListItem[]
  endpointUrl: string
  /** Rendered between the endpoint card and the API-key cards. */
  connectedApps?: React.ReactNode
}

const CARD = 'rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]'
const BUTTON_PRIMARY =
  'inline-flex items-center rounded-lg bg-[#059669] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#047857] disabled:opacity-50'
const BUTTON_QUIET =
  'inline-flex items-center rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50'

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

function claudeDesktopSnippet(endpointUrl: string, key?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        whatstage: key
          ? { url: endpointUrl, headers: { Authorization: `Bearer ${key}` } }
          : { url: endpointUrl },
      },
    },
    null,
    2,
  )
}

function claudeCodeCommand(endpointUrl: string, key?: string): string {
  const base = `claude mcp add --transport http whatstage ${endpointUrl}`
  return key ? `${base} --header "Authorization: Bearer ${key}"` : base
}

export function ApiKeysPanel({ keys, endpointUrl, connectedApps }: ApiKeysPanelProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ name: string; plaintext: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const activeKeys = keys.filter((k) => !k.revokedAt)
  const revokedKeys = keys.filter((k) => k.revokedAt)

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const keyName = name
    startTransition(async () => {
      const result = await createApiKey(keyName)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRevealed({ name: keyName, plaintext: result.plaintext })
      setName('')
      setCopied(false)
    })
  }

  function handleRevoke(id: string) {
    setError(null)
    startTransition(async () => {
      const result = await revokeApiKey(id)
      if (!result.ok) setError(result.error)
    })
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className={CARD}>
        <h2 className="text-[15px] font-semibold text-[#111827]">MCP server</h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Connect an AI assistant (Claude, Claude Code, Cursor) to WhatStage. It can read leads, conversations,
          and the images or files customers sent, reply as you, and manage projects.
        </p>
        <dl className="mt-4 text-[13px]">
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">Endpoint</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code className="font-mono text-[#111827]">{endpointUrl}</code>
            <button type="button" className={BUTTON_QUIET} onClick={() => copy(endpointUrl)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </dd>
        </dl>
        <p className="mt-4 text-[13px] text-[#374151]">
          Add the endpoint in your AI app (claude.ai &rarr; Settings &rarr; Connectors &rarr; Add custom connector, or
          Claude Desktop / Cursor MCP settings). No key needed: the app opens a WhatStage sign-in page and you approve
          the connection there.
        </p>
        <details className="mt-3 text-[13px] text-[#374151]">
          <summary className="cursor-pointer font-medium">Setup snippets</summary>
          <p className="mt-2 text-[12px] font-medium">Claude Desktop / Cursor config</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-[#F9FAFB] p-3 font-mono text-[11px] text-[#111827]">
            {claudeDesktopSnippet(endpointUrl)}
          </pre>
          <p className="mt-3 text-[12px] font-medium">Claude Code</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-[#F9FAFB] p-3 font-mono text-[11px] text-[#111827]">
            {claudeCodeCommand(endpointUrl)}
          </pre>
        </details>
      </div>

      {connectedApps}

      {revealed ? (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-6">
          <h3 className="text-[14px] font-semibold text-[#065F46]">Key &ldquo;{revealed.name}&rdquo; created</h3>
          <p className="mt-1 text-[13px] text-[#047857]">
            Copy it now. For your security it will not be shown again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-[12px] text-[#111827]">
              {revealed.plaintext}
            </code>
            <button type="button" className={BUTTON_QUIET} onClick={() => copy(revealed.plaintext)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <details className="mt-4 text-[13px] text-[#065F46]">
            <summary className="cursor-pointer font-medium">Setup snippets</summary>
            <p className="mt-2 text-[12px] font-medium">Claude Desktop / claude.ai connector config</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-3 font-mono text-[11px] text-[#111827]">
              {claudeDesktopSnippet(endpointUrl, revealed.plaintext)}
            </pre>
            <p className="mt-3 text-[12px] font-medium">Claude Code</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-3 font-mono text-[11px] text-[#111827]">
              {claudeCodeCommand(endpointUrl, revealed.plaintext)}
            </pre>
          </details>
          <button type="button" className={`${BUTTON_QUIET} mt-4`} onClick={() => setRevealed(null)}>
            Done
          </button>
        </div>
      ) : null}

      <form onSubmit={handleCreate} className={CARD}>
        <h3 className="text-[14px] font-semibold text-[#111827]">API keys (advanced)</h3>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          For scripts and tools that cannot open a sign-in page. A key grants the same access as a connected app.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude Desktop on my laptop"
            maxLength={60}
            className="flex-1 rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px] text-[#111827] focus:border-[#059669] focus:outline-none"
            aria-label="Key name"
          />
          <button type="submit" className={BUTTON_PRIMARY} disabled={isPending || !name.trim()}>
            {isPending ? 'Creating…' : 'Create key'}
          </button>
        </div>
        {error ? <p className="mt-2 text-[13px] text-[#B91C1C]">{error}</p> : null}
      </form>

      <div className={CARD}>
        <h3 className="text-[14px] font-semibold text-[#111827]">Active keys</h3>
        {activeKeys.length === 0 ? (
          <p className="mt-2 text-[13px] text-[#6B7280]">No active keys.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#F3F4F6]">
            {activeKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[#111827]">{k.name}</p>
                  <p className="mt-0.5 font-mono text-[12px] text-[#6B7280]">{k.prefix}…</p>
                  <p className="mt-0.5 text-[12px] text-[#9CA3AF]">
                    Created {formatDate(k.createdAt)} · Last used {formatDate(k.lastUsedAt)} · Scopes: {k.scopes.join(', ') || 'none'}
                  </p>
                </div>
                <button type="button" className={BUTTON_QUIET} disabled={isPending} onClick={() => handleRevoke(k.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {revokedKeys.length > 0 ? (
          <p className="mt-4 text-[12px] text-[#9CA3AF]">
            {revokedKeys.length} revoked key{revokedKeys.length === 1 ? '' : 's'} hidden.
          </p>
        ) : null}
      </div>
    </section>
  )
}
