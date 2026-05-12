import {
  type QualificationAnswers,
  type QualificationConfig,
  type QualificationOutcomeAction,
  type QualificationOutcomeMatch,
} from '@/app/a/[slug]/_kinds/qualification/schema'
import { scoreQualification } from './handlers/qualification.score'

export interface QualificationOutcomeResult {
  outcome: string
  score: number | null
  matchedOutcome: QualificationOutcomeAction
  missing_required: string[]
}

function isDisqualifiedOutcome(outcome: string): boolean {
  return /disqual|not_fit|no_fit|unfit|lost|cold/i.test(outcome)
}

function syntheticPendingReviewOutcome(): QualificationOutcomeAction {
  return {
    id: 'pending_review',
    label: 'Needs review',
    outcome: 'pending_review',
    match: { kind: 'manual_review' },
    to_stage_id: null,
    messenger_text: '',
    attach_action_page_id: null,
    attach_cta_label: '',
    public_message: '',
  }
}

function reviewOutcome(config: QualificationConfig): QualificationOutcomeAction {
  return (
    config.outcomes.find(
      (o) =>
        o.outcome === 'pending_review' ||
        o.id === 'pending_review' ||
        o.match.kind === 'manual_review',
    ) ?? syntheticPendingReviewOutcome()
  )
}

function fallbackOutcome(config: QualificationConfig): QualificationOutcomeAction {
  return (
    config.outcomes.find(
      (o) =>
        o.outcome === 'pending_review' ||
        o.id === 'pending_review' ||
        o.match.kind === 'manual_review',
    ) ??
    config.outcomes.find(
      (o) =>
        o.id === 'disqualified' ||
        o.match.kind === 'score_below' ||
        isDisqualifiedOutcome(o.outcome),
    ) ??
    syntheticPendingReviewOutcome()
  )
}

function answerMatches(
  match: QualificationOutcomeMatch,
  answers: QualificationAnswers,
  score: number,
): boolean {
  switch (match.kind) {
    case 'score_at_least':
      return score >= match.value
    case 'score_below':
      return score < match.value
    case 'manual_review':
      return false
    case 'answer_equals': {
      const answer = answers[match.question_id]
      if (Array.isArray(answer)) return answer.includes(String(match.value))
      return answer === match.value
    }
    case 'answer_includes': {
      const answer = answers[match.question_id]
      if (Array.isArray(answer)) return answer.includes(match.value)
      return answer === match.value
    }
  }
}

export function evaluateQualificationOutcome(
  config: QualificationConfig,
  answers: QualificationAnswers,
): QualificationOutcomeResult {
  const { score, missing_required } = scoreQualification(config, answers)
  const review = reviewOutcome(config)

  if (config.scoring.mode === 'manual_review') {
    return {
      outcome: review.outcome,
      score: null,
      matchedOutcome: review,
      missing_required,
    }
  }

  if (missing_required.length > 0) {
    return {
      outcome: review.outcome,
      score,
      matchedOutcome: review,
      missing_required,
    }
  }

  const matched =
    config.outcomes.find((outcome) => answerMatches(outcome.match, answers, score)) ??
    fallbackOutcome(config)

  return {
    outcome: matched.outcome,
    score,
    matchedOutcome: matched,
    missing_required,
  }
}
