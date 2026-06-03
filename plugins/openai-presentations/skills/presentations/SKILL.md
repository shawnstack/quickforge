---
name: presentations
description: Use this skill when the user asks to create, edit, outline, storyboard, review, or improve presentations, slide decks, pitch decks, lecture decks, executive decks, or PPTX-oriented content.
metadata:
  displayName: Presentations
  version: 0.1.0
  tags:
    - presentations
    - slides
    - decks
    - storytelling
    - pptx
---

# Presentations skill

Use this skill to create or improve presentation deliverables. A good deck is not just text split across slides: it has a clear audience, narrative arc, slide-level purpose, visual hierarchy, and a practical speaking or reading flow.

This QuickForge adaptation intentionally does **not** depend on Codex cache paths, Codex workspace dependencies, or `@oai/artifact-tool`. Prefer Markdown slide outlines, speaker notes, and deck specs first. If the user explicitly needs PPTX generation, explain the available local workflow and ask before using shell commands or external tools.

## When to use

Use this skill for requests involving:

- New slide decks, pitch decks, executive updates, board decks, sales decks, training decks, lecture decks, or conference talks.
- Slide outlines, storyboards, speaker notes, talk tracks, or visual direction.
- Reviewing or rewriting existing deck content.
- Turning a report, notes, transcript, or dataset into a presentation.
- PPTX-oriented deliverables where the first output can be a precise deck blueprint.

## Deck principles

1. **Audience first.** Determine who the deck is for and what decision or understanding it should drive.
2. **One main idea per slide.** Each slide should have a clear takeaway title.
3. **Narrative arc.** Use a logical flow: context → problem → insight → recommendation → next steps.
4. **Visual hierarchy.** Prefer concise text, meaningful grouping, and clear emphasis.
5. **Evidence and action.** For business decks, tie claims to evidence and end with actionable next steps.
6. **Readable density.** Executive decks can be denser than live talks; live talks need fewer words and stronger speaker notes.
7. **Consistency.** Keep terminology, structure, and visual patterns consistent across slides.

## Recommended workflow

### New presentation

1. Identify audience, purpose, desired length, tone, and delivery mode.
2. Create a deck outline with slide titles and slide objectives.
3. Draft slide-by-slide content:
   - Slide title as takeaway.
   - Key bullets or content blocks.
   - Suggested visual.
   - Optional speaker notes.
4. Check flow and remove redundancy.
5. If writing to disk, create a Markdown deck spec or outline file unless the user requested another format.

### Editing or reviewing a deck

1. Read the provided deck text, outline, or source files.
2. Identify structural issues before line-level rewrites.
3. Improve slide titles into takeaways.
4. Reduce overloaded slides.
5. Suggest visual alternatives for dense text.
6. Preserve user constraints and brand/tone requirements.

## Recommended slide spec format

When creating a deck blueprint, use this structure:

```markdown
# Deck Title

Audience:
Goal:
Recommended length:
Tone:

## Slide 1 — Takeaway title
Purpose:
Content:
- ...
Visual direction:
Speaker notes:

## Slide 2 — Takeaway title
...
```

For concise requests, a simpler numbered slide list is fine.

## Visual guidance

- Prefer diagrams, timelines, matrices, charts, screenshots, or process flows when they communicate better than bullets.
- Do not invent data. If data is missing, propose placeholders or ask for inputs.
- For charts, specify chart type, data columns, key annotation, and intended takeaway.
- For pitch decks, prioritize problem, urgency, solution, differentiation, traction, business model, go-to-market, team, and ask.

## PPTX-oriented requests

QuickForge currently provides this as a deck-planning/workflow skill, not a bundled presentation runtime. For PPTX deliverables:

- First create a precise Markdown deck spec.
- If PPTX generation is required, ask before running shell commands.
- Do not assume PowerPoint, LibreOffice, pandoc, or other converters are installed.
- Do not install dependencies unless the user explicitly asks and approves.

## Final response guidance

When delivering a deck spec inline, keep it slide-focused. When files are created or edited, include:

- The file path.
- Number of slides or sections.
- A short summary of the narrative and any assumptions.
