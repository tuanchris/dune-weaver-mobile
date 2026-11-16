/**
 * Pattern Hub votes, as on duneweaver.com/patterns: up or down, one per account,
 * the same vote again takes it back. Scores (ups minus downs) come from the
 * site's public GET /api/patterns/votes, once per app session; the account's own
 * votes from GET /api/patterns/my-votes, once per account. POST /api/patterns/vote
 * casts one with the app's token (any signed-in account with a verified email,
 * plan or not, like the website) and answers the new vote and score.
 */
import { create } from 'zustand'
import { SITE, hubFetch } from './hubAuth'

export type HubVoteValue = -1 | 0 | 1

export const useHubVotes = create<{ counts: Record<string, number> | null; mine: Record<string, HubVoteValue> }>(() => ({
  counts: null,
  mine: {},
}))

let countsRead: Promise<void> | null = null
let mineFor: string | null = null

/** Read the scores (once a session; a failure retries next time) and, for a signed-in `account`, its votes. */
export function loadHubVotes(account: string | null): void {
  countsRead ??= fetch(`${SITE}/api/patterns/votes`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { counts } = (await res.json()) as { counts?: Record<string, number> }
      useHubVotes.setState({ counts: counts ?? {} })
    })
    .catch(() => {
      countsRead = null
    })
  if (account === mineFor) return
  mineFor = account
  useHubVotes.setState({ mine: {} })
  if (!account) return
  hubFetch('/api/patterns/my-votes')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { votes } = (await res.json()) as { votes?: Record<string, HubVoteValue> }
      if (mineFor === account) useHubVotes.setState({ mine: votes ?? {} })
    })
    .catch(() => {
      if (mineFor === account) mineFor = null
    })
}

/** Vote `id` up or down (again = take it back). Throws the site's reason (e.g. an unverified email). */
export async function castHubVote(id: string, vote: 1 | -1): Promise<void> {
  const res = await hubFetch('/api/patterns/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId: id, vote }),
  })
  const body = (await res.json().catch(() => ({}))) as { vote?: HubVoteValue; count?: number; error?: string }
  if (!res.ok || typeof body.count !== 'number') throw new Error(body.error ?? `The vote didn’t go through (HTTP ${res.status})`)
  const s = useHubVotes.getState()
  useHubVotes.setState({ counts: { ...s.counts, [id]: body.count }, mine: { ...s.mine, [id]: body.vote ?? 0 } })
}
