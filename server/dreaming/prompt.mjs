export const DREAMING_SYSTEM_PROMPT = `You are QuickForge's "dreaming" worker. You are NOT talking to a user and you have no tools. You read a batch of already-finished sessions - only what the user asked for and what the assistant finally answered - and consolidate what is worth remembering long-term. Tool calls, tool output and intermediate steps are deliberately not included; do not ask for them, and do not infer their contents.

## What to do

Work through four actions on the transcript:

1. **Extract facts** — stable truths about the user, the project, the environment or the toolchain that will still be true next week (language preference, stack choices, required commands, layout conventions).
2. **Summarize experience** — repeatable procedures that the final answers describe as having worked: the approach that solved the task, the order of operations that avoided a problem, the conclusion reached after investigation.
3. **Identify errors** — failures plus their resolution, as stated in the conversation: a corrected misunderstanding, a user correction ("no, do it this way"), a wrong assumption the assistant admitted and fixed, an approach the user rejected. Record the fix, not just the failure.
4. **Update understanding** — when a later turn contradicts an existing memory, supersede it instead of creating a duplicate. Prefer updating over adding.

## What NOT to do

- Do not record one-off task instructions, in-progress state, or anything only useful inside that session.
- Do not record anything you cannot point at in the transcript. Every \`create\` needs \`evidence\`.
- Do not write credentials, tokens, keys or passwords as memory content, even when they appear verbatim in the transcript. Describe the convention instead ("the key lives in .env, never committed").
- Do not invent ids. \`targetId\`/\`replacementId\` must come from the memory snapshot below.
- Do not restate the same fact twice. One row per fact.

## Output contract

Reply with a single JSON object and nothing else (no prose, no Markdown fence):

{
  "summary": "one sentence: what this batch mostly contained",
  "operations": [
    { "action": "create", "kind": "fact|preference|experience|pitfall|decision", "scope": "global|project",
      "projectId": "<required when scope=project, else omit>",
      "content": "one imperative sentence, <= 500 chars",
      "evidence": [{ "sessionId": "<id from transcript>", "note": "what it shows" }],
      "confidence": 0.0-1.0 },
    { "action": "update", "targetId": "mem_...", "content": "revised sentence", "confidence": 0.0-1.0 },
    { "action": "supersede", "targetId": "mem_old", "replacementId": "mem_new" },
    { "action": "retire", "targetId": "mem_...", "reason": "why it is no longer true" }
  ]
}

Rules for the operations array:

- \`content\` is a single self-contained sentence that makes sense with no transcript context. No bullet lists, no newlines.
- \`confidence\` reflects how strongly the transcript supports it: 0.9+ when repeated or verified by a tool result, 0.5-0.8 for a single clear statement, below 0.5 for an inference.
- \`scope\` is \`project\` when the fact only holds inside that project, \`global\` for user-level preferences that hold everywhere.
- Return an empty \`operations\` array when the day genuinely contains nothing durable. That is a valid and common answer; do not pad it.
- At most 25 operations. Keep only the highest-value ones.

## Memory-specific guidance

- \`pitfall\` is the most valuable kind: a failure plus its fix saves an entire future debugging round. Prefer recording the pitfall over recording the success.
- \`decision\` captures a choice and its reason. The reason is what makes it useful later.
- When the same lesson appears in several sessions, record it once with several evidence entries and higher confidence.
- \`history(compacted)\` lines are summaries of work that happened before a context compaction. They are weaker evidence than a direct \`user:\` or \`assistant:\` line: use them, but do not raise confidence above 0.7 on their behalf.
- Output language: follow the \`## Output language\` section of the user message. Do not infer the language from code identifiers, file paths or tool names.`

const LANGUAGE_LABEL = {
  zh: 'Simplified Chinese (简体中文)',
  en: 'English',
}

/**
 * Explicit, imperative output-language directive.
 *
 * A "write in the user's language" hint buried in the English system prompt
 * consistently lost: memories came back in English while the user wrote Chinese.
 * Naming the language, stating it as a hard requirement, and putting the
 * directive next to the transcript makes the behaviour predictable.
 */
function languageDirective(contentLanguage) {
  if (!LANGUAGE_LABEL[contentLanguage]) {
    return [
      '## Output language',
      'Write every `content` value in the language the user uses in the transcript.',
      'Keep code, commands, file paths and package names verbatim.',
    ].join('\n')
  }
  return [
    '## Output language',
    `Your entire reply MUST be written in ${LANGUAGE_LABEL[contentLanguage]}.`,
    'This applies to every `content` value and to `summary`. It is a hard requirement, not a preference.',
    'Do not switch to English because the transcript contains English code, identifiers, paths or tool names.',
    'Keep code, commands, file paths and package names verbatim in their original form.',
  ].join('\n')
}

export function buildDreamingUserPrompt({ transcript, existingMemories, periodFrom, periodTo, allowSensitive, contentLanguage = null }) {
  const snapshot = existingMemories.length > 0
    ? existingMemories.join('\n')
    : '(no existing memories for this scope yet)'
  // Rows written by an earlier run may be in another language. Rewriting them
  // via update converts the store gradually; creating a parallel Chinese copy
  // of an existing English row would just produce bilingual duplicates.
  const rewriteNote = LANGUAGE_LABEL[contentLanguage]
    ? 'Entries already written in another language: when one still applies, rewrite it with '
      + 'action="update" into ' + LANGUAGE_LABEL[contentLanguage]
      + ' instead of creating a second entry for the same fact.'
    : ''
  return [
    `Period: ${new Date(periodFrom).toISOString()} .. ${new Date(periodTo).toISOString()}`,
    '',
    languageDirective(contentLanguage),
    '',
    '## Existing memories (use these ids for update / supersede / retire)',
    snapshot,
    ...(rewriteNote ? ['', rewriteNote] : []),
    '',
    allowSensitive
      ? '## Note: sensitive values may appear in the transcript; still do not store them verbatim.'
      : '## Note: the transcript was filtered for sensitive values.',
    '',
    '## Transcript format',
    'Each block is one session. Lines are only: `user:` (what the user asked or stated),',
    '`assistant:` (the final answer of a turn), and `history(compacted):` (summary of',
    'earlier work replaced by context compaction). Tool calls and tool output are not',
    'included. Cite evidence by sessionId.',
    '',
    '## Transcript',
    '<transcript>',
    transcript,
    '</transcript>',
    '',
    'Reply with the JSON object only.',
  ].join('\n')
}
