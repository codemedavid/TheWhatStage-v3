import Link from 'next/link'
import { createCampaign } from '../actions/campaign'

export function NewCampaignForm({ initialError }: { initialError: string | null }) {
  return (
    <div data-funnels-root>
      <div className="fn-wrap">
        <header className="fn-head">
          <div className="fn-head-copy">
            <div className="fn-eyebrow">
              <span>Workspace · Funnels · New campaign</span>
            </div>
            <h1>New campaign</h1>
            <p>
              Start with a name and a short pitch. You&apos;ll add funnels, set
              the personality, and pick a goal action page on the next screen.
            </p>
          </div>
          <div className="fn-actions">
            <Link href="/dashboard/funnels" className="fn-btn fn-btn-ghost">
              Cancel
            </Link>
          </div>
        </header>

        {initialError && (
          <div className="fnl-banner error" role="alert">
            {initialError}
          </div>
        )}

        <form action={createCampaign} className="fnl-form-card">
          <div className="fnl-field">
            <label htmlFor="campaign-name">Name</label>
            <input
              id="campaign-name"
              name="name"
              type="text"
              required
              minLength={1}
              maxLength={120}
              placeholder="Hormozi-style sales campaign"
              autoFocus
            />
          </div>
          <div className="fnl-field">
            <label htmlFor="campaign-description">Short description</label>
            <textarea
              id="campaign-description"
              name="description"
              rows={3}
              maxLength={2000}
              placeholder="What this campaign is for. e.g. Get cold Messenger leads through qualification then booking."
            />
          </div>
          <div className="fnl-form-foot">
            <Link href="/dashboard/funnels" className="fn-btn fn-btn-ghost">
              Cancel
            </Link>
            <button type="submit" className="fn-btn fn-btn-primary">
              Create campaign
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
