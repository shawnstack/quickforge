---
description: Create, analyze, structure, review, or improve a spreadsheet-oriented deliverable.
argument-hint: "[spreadsheet request]"
allow_edit: true
allow_commands: false
---

Use the Spreadsheets skill for this request. Produce a spreadsheet-oriented deliverable with clear structure, assumptions, formulas, tables, and validation appropriate to the user's goal.

Request:

$ARGUMENTS

If the user asked for a file, prefer Markdown tables, CSV/TSV, or a precise workbook spec unless another format is explicitly requested. Ask before using shell commands or external tools for XLSX generation or editing.
