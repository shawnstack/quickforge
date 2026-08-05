---
name: spreadsheets
description: Use this skill when the user asks to create, edit, analyze, model, review, visualize, or structure spreadsheet workbooks such as XLSX-oriented files, CSV/TSV tables, trackers, dashboards, financial models, formulas, charts, or data-analysis sheets.
metadata:
  displayName: Spreadsheets
  version: 0.1.0
  tags:
    - spreadsheets
    - xlsx
    - csv
    - dashboards
    - analysis
    - formulas
---

# Spreadsheets skill

Use this skill to create or improve spreadsheet-oriented deliverables. A good spreadsheet is organized, auditable, readable, and fit for the user's purpose. For analysis-heavy tasks, correctness matters as much as formatting.

This QuickForge adaptation intentionally does **not** depend on Codex cache paths, Codex workspace dependencies, or `@oai/artifact-tool`. Prefer spreadsheet plans, CSV/TSV outputs, formulas, workbook specs, or Markdown tables first. If the user explicitly needs XLSX generation or editing, explain the available local workflow and ask before using shell commands or external tools.

## When to use

Use this skill for requests involving:

- Creating trackers, schedules, budgets, calculators, models, dashboards, reports, or tabular templates.
- Working with `.xlsx`, `.xls`, `.csv`, `.tsv`, or Google Sheets-targeted spreadsheet content.
- Designing formulas, validations, tables, pivots, charts, or workbook structure.
- Analyzing spreadsheet data or answering questions about provided tabular files.
- Reviewing or improving workbook layout, formulas, assumptions, or data quality.

## Spreadsheet principles

1. **Separate purpose, inputs, calculations, and outputs.** For non-trivial workbooks, avoid mixing everything on one sheet.
2. **Make assumptions visible.** Put assumptions near the top or in a dedicated sheet/section.
3. **Use clear labels and units.** Headers should be unambiguous.
4. **Prefer auditable formulas.** Explain formulas and avoid hidden magic.
5. **Design for maintenance.** Tables should be easy to extend.
6. **Validate important outputs.** Include checks for reconciliations, totals, or formula consistency when relevant.
7. **Use charts only when they add insight.** Every chart should have a takeaway.

## Recommended workbook structures

### Simple tracker/template

- Title and usage note.
- Main table with clear columns.
- Status or category values if useful.
- Summary section only if it helps.

### Analysis workbook

- Executive summary or dashboard.
- Source data.
- Assumptions.
- Calculations/model.
- Outputs/charts.
- Checks, if correctness depends on formulas or reconciliations.

### Financial or operations model

- Summary/dashboard.
- Inputs/assumptions.
- Historical/source data.
- Model/calculations.
- Scenarios/sensitivity.
- Checks.

## Recommended workflow

### New spreadsheet-oriented deliverable

1. Identify the user goal, output format, data sources, and level of rigor.
2. Choose workbook/sheet structure before writing formulas or tables.
3. Draft the table/schema/formulas/charts.
4. Validate calculations and edge cases.
5. If writing to disk, use CSV/TSV/Markdown when sufficient; ask before attempting XLSX generation.

### Editing or analyzing existing spreadsheet data

1. Read the relevant file(s) first.
2. Determine whether the user wants an answer, a file edit, or a new artifact.
3. Preserve existing formulas and patterns unless asked to refactor.
4. For formula changes, explain changed logic.
5. For data analysis, call out data quality risks and assumptions.

## Formula guidance

- Prefer formulas that are understandable to spreadsheet users.
- Use consistent row/column references.
- Document non-obvious formulas.
- Avoid volatile functions unless needed.
- For financial models, keep assumptions editable and outputs linked.

## Chart guidance

When specifying charts, include:

- Chart type.
- Source data range or fields.
- X/Y axes.
- Series.
- Main takeaway.
- Any annotations or formatting guidance.

Do not create charts with invented data. If data is missing, ask for it or propose placeholders.

## XLSX / Google Sheets-oriented requests

QuickForge currently provides this as a spreadsheet-planning/workflow skill, not a bundled spreadsheet runtime. For XLSX or Google Sheets deliverables:

- First create a precise workbook spec, CSV/TSV data, or formulas.
- If XLSX creation/editing is required, ask before running shell commands.
- Do not assume Excel, LibreOffice, Python libraries, Node packages, or Google APIs are available.
- Do not install dependencies unless the user explicitly asks and approves.

## Final response guidance

When delivering spreadsheet content inline, make it easy to copy into a sheet. When files are created or edited, include:

- The file path.
- The sheet/table structure.
- Key formulas or assumptions.
- Validation performed or remaining risks.
