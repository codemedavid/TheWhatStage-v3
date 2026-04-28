export const DEFAULT_STAGES: { name: string; description: string; isDefault: boolean }[] = [
  { name: 'New Lead',    description: 'Freshly captured leads.',     isDefault: true  },
  { name: 'Contacted',   description: 'Initial outreach sent.',      isDefault: false },
  { name: 'Qualified',   description: 'Confirmed fit and interest.', isDefault: false },
  { name: 'Unqualified', description: 'Not a fit right now.',        isDefault: false },
  { name: 'Proposal',    description: 'Proposal or quote sent.',     isDefault: false },
  { name: 'Won',         description: 'Closed-won deals.',           isDefault: false },
  { name: 'Lost',        description: 'Closed-lost deals.',          isDefault: false },
]
