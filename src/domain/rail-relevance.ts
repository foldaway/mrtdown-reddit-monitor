const RAIL_PHRASE_PATTERN =
  /(additional travel time|regular svc|travel time|additional travell?ing time)/i;

const RAIL_WORDS = new Set(
  [
    'MRT',
    'LRT',
    'train',
    'track',
    'line',
    'fault',
    'breakdown',
    'BPLRT',
    'SKLRT',
    'PGLRT',
    'SPLRT',
    'CCL',
    'DTL',
    'EWL',
    'NSL',
    'NEL',
    'TEL',
    'JRL',
    'CRL',
  ].map((word) => word.toLowerCase()),
);

export function isTextRailRelated(text: string): boolean {
  const segments = new Intl.Segmenter('en-US', {
    granularity: 'word',
  }).segment(text);
  for (const segment of segments) {
    if (
      segment.isWordLike &&
      RAIL_WORDS.has(segment.segment.toLocaleLowerCase('en-US'))
    ) {
      return true;
    }
  }
  return RAIL_PHRASE_PATTERN.test(text);
}

export function isSourceRailRelated(
  source: Pick<{ title: string | null; body: string | null }, 'title' | 'body'>,
): boolean {
  return [source.title, source.body].some(
    (text) => text !== null && isTextRailRelated(text),
  );
}
