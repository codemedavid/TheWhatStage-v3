import './workflows.css'

export const dynamic = 'force-dynamic'

export default function WorkflowsPage() {
  return (
    <div data-workflows-list>
      <div className="wfl-wrap">
        <div className="wfl-unavailable">
          <h2>Workflows</h2>
          <p>Currently not available — this feature is still in development.</p>
        </div>
      </div>
    </div>
  )
}
