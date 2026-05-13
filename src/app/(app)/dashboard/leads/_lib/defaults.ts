import type { PipelineStageKind } from '@/lib/action-pages/default-stage'

export const DEFAULT_STAGES: {
  name: string
  description: string
  isDefault: boolean
  kind: PipelineStageKind
}[] = [
  { name: 'New Lead',    description: 'Freshly captured leads.',     isDefault: true,  kind: 'entry'      },
  { name: 'Contacted',   description: 'Initial outreach sent.',      isDefault: false, kind: 'nurture'    },
  { name: 'Qualified',   description: 'Confirmed fit and interest.', isDefault: false, kind: 'qualifying' },
  { name: 'Unqualified', description: 'Not a fit right now.',        isDefault: false, kind: 'lost'       },
  { name: 'Proposal',    description: 'Proposal or quote sent.',     isDefault: false, kind: 'decision'   },
  { name: 'Won',         description: 'Closed-won deals.',           isDefault: false, kind: 'won'        },
  { name: 'Lost',        description: 'Closed-lost deals.',          isDefault: false, kind: 'lost'       },
]
