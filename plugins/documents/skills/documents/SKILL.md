---
name: documents
description: Use this skill when the user asks to create, edit, review, rewrite, structure, summarize, or export documents such as Markdown, reports, proposals, briefs, manuals, DOCX-oriented drafts, meeting notes, or knowledge-base articles.
metadata:
  displayName: Documents
  version: 0.1.0
  tags:
    - documents
    - writing
    - editing
    - reports
    - docx
---

# Documents skill

Use this skill to produce high-quality document deliverables in QuickForge. A document deliverable should be useful as a standalone artifact: clear structure, accurate content, appropriate tone, and enough polish that the user can copy, publish, or hand it off.

This QuickForge adaptation intentionally does **not** depend on Codex cache paths, Codex workspace dependencies, or `@oai/artifact-tool`. Prefer Markdown and plain-text deliverables first. If the user explicitly needs DOCX/PDF/export automation, explain the available local workflow and ask before using shell commands or external converters.

## When to use

Use this skill for requests involving:

- Drafting reports, proposals, memos, specs, essays, documentation, README files, knowledge-base articles, manuals, policies, or meeting notes.
- Improving, restructuring, proofreading, translating, or summarizing an existing document.
- Creating DOCX-oriented content, even if the final QuickForge deliverable is initially Markdown.
- Turning raw notes, transcripts, bullet points, or source files into a polished document.
- Creating templates, outlines, style guides, checklists, or editorial feedback.

Do not use this skill for code-only tasks unless the requested output is a document about code.

## Output principles

1. **Clarify the deliverable shape** only when necessary. If the requested format is obvious, start directly.
2. **Choose a structure before writing.** For non-trivial documents, create a short outline internally, then draft.
3. **Preserve user intent and constraints.** Match requested tone, language, audience, length, and format.
4. **Separate facts from assumptions.** If source material is incomplete, say what you inferred.
5. **Make the document scannable.** Use headings, bullets, tables, callouts, and summaries where helpful.
6. **Avoid filler.** Prefer concise, useful content over generic prose.
7. **Cite or reference sources when the user provides them.** Do not invent citations.

## Recommended workflow

### New document

1. Identify audience, goal, format, and constraints.
2. Create an outline with sections and key messages.
3. Draft the document in Markdown unless the user requested another explicit text format.
4. Review for clarity, consistency, tone, and missing requirements.
5. If writing to the workspace, use a clear filename and ask/confirm when the location is ambiguous.

### Editing an existing document

1. Read the relevant file(s) first.
2. Preserve the user's existing structure unless a rewrite is requested.
3. Make targeted edits when the request is specific.
4. For broad edits, summarize the main changes.
5. Avoid deleting important user content without calling it out.

### Review or critique

Produce actionable feedback:

- Overall assessment.
- Highest-impact improvements.
- Structural issues.
- Clarity/tone issues.
- Accuracy or missing information risks.
- Suggested rewrite snippets when useful.

## Markdown conventions

- Use one `#` title unless embedding into an existing document.
- Prefer descriptive headings.
- Use tables only when they improve comparison or scanability.
- Keep list items parallel.
- Use code fences for code/config snippets.
- Avoid excessive emoji or decoration unless requested.

## DOCX/PDF-oriented requests

QuickForge currently provides this as a writing/workflow skill, not a bundled document runtime. For DOCX/PDF deliverables:

- First create a clean Markdown source or text draft.
- If conversion is needed, ask before running shell commands.
- Do not assume `pandoc`, Word, LibreOffice, or other converters are installed.
- Do not install dependencies unless the user explicitly asks and approves.

## Final response guidance

When the document is produced inline, keep the final response focused on the deliverable. When files are created or edited, include:

- The file path.
- A short summary of what changed.
- Any assumptions or follow-up actions.
