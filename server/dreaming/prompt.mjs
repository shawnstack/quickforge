export const DREAMING_SYSTEM_PROMPT = `You are QuickForge's "dreaming" worker. You are NOT talking to a user and you have no tools. You read a batch of already-finished sessions - only what the user asked for and what the assistant finally answered - and maintain one plain bullet list of long-term notes. Tool calls, tool output and intermediate steps are deliberately not included; do not ask for them, and do not infer their contents.

## What the notes are for

The list is injected verbatim into every future session, so it competes with the user's own instructions for attention. Keep it short, concrete and still true next week.

Worth keeping:

- Stable facts about the user, the project, the environment or the toolchain (language preference, stack choices, required commands, layout conventions).
- Repeatable procedures that the final answers describe as having worked.
- Failures plus their fix: a corrected misunderstanding, a user correction, a rejected approach. Record the fix, not just the failure.
- Decisions and their reason.

Not worth keeping:

- One-off task instructions, in-progress state, anything only useful inside that session.
- Anything you cannot point at in the transcript.
- Credentials, tokens, keys or passwords, even when they appear verbatim. Describe the convention instead ("the key lives in .env, never committed").

## How to merge

You are given the CURRENT list. Return the list this batch should leave behind:

- A note that still holds stays, unchanged.
- A note this batch sharpens or corrects: return the corrected sentence in its place.
- When two notes disagree, the newest evidence wins. Repetition across sessions only outweighs recency when the newer statement was a single passing mention.
- A note this batch proves wrong or obsolete: drop it.
- A genuinely new note: add it.
- Two notes that say the same thing: return one.
- The user message may list notes that were never recalled for a long time. Treat them as deletion candidates — but a note is in that list because nobody searched for it, not because it is wrong. Drop it only when this batch also shows it no longer applies, or when it is a trivial restatement; keep anything that is cheap to keep and expensive to lose (safety rules, release gates, destructive-command warnings).

Prefer rewriting an existing note over adding a near-duplicate. Do not keep a note merely because it was already there.

## Output contract

Reply with the bullet list and nothing else:

- No prose, no preamble, no "here are the notes", no closing remark.
- No headings, no code fences, no numbering.
- One note per line, each starting with "- ".
- Optionally prefix a note with its kind: "- [pitfall] 回滚前先用 git log 确认后续没有改动". Allowed kinds: fact, preference, experience, pitfall, decision.
- Each note is one self-contained sentence under 300 characters. It must make sense with no transcript context.
- At most 60 notes, ordered from most to least important. When the budget is exceeded the tail is dropped, so the last lines must be the ones you are most willing to lose.
- An empty reply is a valid answer when the day genuinely contains nothing durable. Do not pad it.

## Language

Follow the \`## Output language\` section of the user message. Do not infer the language from code identifiers, file paths or tool names. Keep code, commands, file paths and package names verbatim.`

const LANGUAGE_LABEL = {
  zh: 'Simplified Chinese (简体中文)',
  en: 'English',
}

/**
 * Explicit, imperative output-language directive.
 *
 * A "write in the user's language" hint buried in the English system prompt
 * consistently lost: notes came back in English while the user wrote Chinese.
 * Naming the language, stating it as a hard requirement, and putting the
 * directive next to the transcript makes the behaviour predictable.
 */
function languageDirective(contentLanguage) {
  if (!LANGUAGE_LABEL[contentLanguage]) {
    return [
      '## Output language',
      'Write every note in the language the user uses in the transcript.',
      'Keep code, commands, file paths and package names verbatim.',
    ].join('\n')
  }
  return [
    '## Output language',
    `Your entire reply MUST be written in ${LANGUAGE_LABEL[contentLanguage]}.`,
    'This applies to every note. It is a hard requirement, not a preference.',
    'Do not switch to English because the transcript contains English code, identifiers, paths or tool names.',
    'Keep code, commands, file paths and package names verbatim in their original form.',
  ].join('\n')
}

export function buildDreamingUserPrompt({
  transcript,
  existingNotes = [],
  unusedNotes = [],
  periodFrom,
  periodTo,
  allowSensitive = true,
  contentLanguage = null,
}) {
  // The list can be empty for two reasons now: a first run, or automatic pruning
  // removed everything. Do not claim "first run" — the model only needs to know
  // there is nothing to carry over.
  const snapshot = existingNotes.length > 0
    ? existingNotes.map((note) => `- ${note}`).join('\n')
    : '(the list is empty)'
  const rewriteNote = LANGUAGE_LABEL[contentLanguage]
    ? `Notes already written in another language: rewrite them into ${LANGUAGE_LABEL[contentLanguage]} in place rather than adding a translated duplicate.`
    : ''
  // Only present when there is something to say: an always-empty section would
  // train the model to ignore it.
  const unusedSection = unusedNotes.length > 0
    ? [
      '',
      '## Never recalled (deletion candidates)',
      'These notes existed for a while and `recall_experience` never returned them:',
      ...unusedNotes.map((note) => `- (${note.ageDays} days) ${note.text}`),
      'Being here means nobody searched for it - not that it is wrong. Drop one only if this batch also shows it no longer applies, or if it merely restates another note.',
    ]
    : []
  return [
    `Period: ${new Date(periodFrom).toISOString()} .. ${new Date(periodTo).toISOString()}`,
    '',
    languageDirective(contentLanguage),
    '',
    '## Current notes (return the full list you want to keep, with your changes applied)',
    snapshot,
    ...(rewriteNote ? ['', rewriteNote] : []),
    ...unusedSection,
    '',
    allowSensitive
      ? '## Note: sensitive values may appear in the transcript; still do not store them verbatim.'
      : '## Note: the transcript was filtered for sensitive values.',
    '',
    '## Transcript format',
    'Each block is one session. Lines are only: `user:` (what the user asked or stated),',
    '`assistant:` (the final answer of a turn), and `history(compacted):` (summary of',
    'earlier work replaced by context compaction). Tool calls and tool output are not',
    'included.',
    '',
    '## Transcript',
    '<transcript>',
    transcript,
    '</transcript>',
    '',
    'Reply with the bullet list only.',
  ].join('\n')
}
