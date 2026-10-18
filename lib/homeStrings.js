// Home page text. Merge into strings.js when translating.
export const home = {
  live: 'Live public record · Ghana',
  titleA: 'Your street. Your voice.',
  titleB: 'Their response, in public.',
  sub: 'Report a problem in under a minute, even without signal. Neighbors confirm it, the responsible office is named, and every day it stays open is on the record.',
  cta: 'Report a problem',
  ctaTracker: 'See who’s fixing things',
  trust: ['No account needed', 'Works offline', 'Exact location never public'],
  mapTag: 'Live reports',
  mapEmpty: 'No reports yet. Be the first.',
  mapNote: (n) => (n === 1 ? '1 report on the map' : `${n} reports on the map`),
  stats: ['Reports filed', 'Confirmed or further', 'Problems resolved', 'Median days to fix'],
  howTitle: 'Three steps. Every one public.',
  steps: [
    { t: 'Snap and pin', d: 'A photo and the exact spot. Saved on your phone first, so weak signal never loses it.' },
    { t: 'Neighbors confirm', d: 'Three confirmations verify the problem and make it hard to ignore.' },
    { t: 'We chase, you watch', d: 'Moderators escalate to whoever is responsible. Every step stays on the record.' },
  ],
  formTitle: 'Report a problem',
  formSub: 'Takes about a minute.',
};
