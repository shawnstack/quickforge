// agent-manager 模块拆分（agent-manager-module-split）：斜杠命令状态解析与
// 内置命令 prompt 模板（/plan /init /review /commit /skill /agent 及自定义命令）
// 从 agent-manager.mjs 逐字符搬移至此；仅对外导出 resolveCommandState，
// 行为与注释语义保持不变。

import { loadSkillToolContext } from './tools/index.mjs'
import { sessionSkillsContext } from './tool-wiring.mjs'
import { mergeSkills, normalizeSkillNames } from './skills.mjs'
import { getAgentProfile, listSubagentProfiles } from './agent-profiles.mjs'
import {
  formatAgentCommandPrompt,
  formatSkillCommandPrompt,
  handleInternalCommand,
  parseInternalCommandInvocation,
  resolveCustomCommandInvocation,
} from './custom-commands.mjs'
import { messageText } from './message-converters.mjs'

const QUICKFORGE_COMMAND_DETAILS_KEY = 'quickforgeCommand'

function normalizedPromptCommand(command) {
  return command?.type === 'plan' ? { type: 'plan' } : null
}

function objectDetails(message) {
  const details = message?.details
  return details && typeof details === 'object' && !Array.isArray(details) ? details : {}
}

function promptCommandFromMessage(message) {
  return normalizedPromptCommand(objectDetails(message)[QUICKFORGE_COMMAND_DETAILS_KEY])
}

function messageWithPromptCommand(message, command) {
  const normalized = normalizedPromptCommand(command)
  if (!normalized || !message || typeof message !== 'object') return message
  return {
    ...message,
    details: {
      ...objectDetails(message),
      [QUICKFORGE_COMMAND_DETAILS_KEY]: normalized,
    },
  }
}

function internalInvocationForPromptCommand(userMessage, command) {
  const normalized = normalizedPromptCommand(command)
  if (normalized?.type === 'plan') {
    // Derive the task from the message text. Strip a leading "/plan" so that
    // toggling plan mode while typing "/plan <task>" yields the clean task —
    // matching the slash-command parse path and avoiding a redundant prefix.
    const raw = messageText(userMessage).trim()
    const planPrefix = raw.match(/^\/plan(?:\s+([\s\S]*))?$/i)
    return { type: 'plan', args: planPrefix ? (planPrefix[1] || '').trim() : raw }
  }
  return parseInternalCommandInvocation(userMessage)
}

function planCommandState(userMessage, args) {
  return {
    userMessage: messageWithPromptCommand(userMessage, { type: 'plan' }),
    commandPrompt: formatPlanCommandPrompt(args),
    permissions: { allowEdit: false, allowCommands: false, allowSubagents: true },
    commandName: 'plan',
  }
}

function parseSlashNameAndTask(args) {
  const trimmed = String(args || '').trim()
  if (!trimmed) return { name: '', task: '' }
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return { name: match?.[1] || '', task: (match?.[2] || '').trim() }
}

async function enabledSkillsForSession(session) {
  // Same sources as the activate_skill tool (loadSkillToolContext), resolved
  // from the session's captured skill selections and workspace.
  const skillContext = await loadSkillToolContext({
    ...sessionSkillsContext(session),
    workspaceRoot: session.projectContext?.workspaceRoot,
  })
  return mergeSkills(skillContext.globalSkills, skillContext.projectSkills)
}

function enabledSkillsLine(enabledSkills) {
  if (enabledSkills.length === 0) return 'No skills are currently enabled.'
  return `Enabled skills: ${enabledSkills.map((skill) => skill.name).join(', ')}.`
}

function availableSubagentsLine(profiles) {
  return `Available subagents: ${profiles.map((profile) => profile.name).join(', ')}.`
}

async function skillCommandState(session, userMessage, args) {
  const { name, task } = parseSlashNameAndTask(args)
  const enabledSkills = await enabledSkillsForSession(session)

  if (!name) {
    return { textResponse: ['Usage: /skill <name> [task]', '', enabledSkillsLine(enabledSkills)].join('\n') }
  }

  const skillName = normalizeSkillNames([name])[0]
  const skill = skillName ? enabledSkills.find((item) => item.name === skillName) : null
  if (!skill) {
    return {
      textResponse: [
        `Unknown or disabled skill: ${name}`,
        '',
        'Usage: /skill <name> [task]',
        '',
        enabledSkillsLine(enabledSkills),
      ].join('\n'),
    }
  }

  return {
    userMessage,
    commandPrompt: formatSkillCommandPrompt(skill.name, task),
    commandName: 'skill',
  }
}

async function agentCommandState(session, userMessage, args) {
  const { name, task } = parseSlashNameAndTask(args)
  const profileOptions = { workspaceRoot: session.projectContext?.workspaceRoot }

  if (!name) {
    const profiles = await listSubagentProfiles(profileOptions)
    return { textResponse: ['Usage: /agent <name> <task>', '', availableSubagentsLine(profiles)].join('\n') }
  }
  if (!task) {
    return { textResponse: 'Usage: /agent <name> <task>' }
  }

  const profile = await getAgentProfile(name, profileOptions)
  if (!profile || profile.enabledAsSubagent !== true) {
    const profiles = await listSubagentProfiles(profileOptions)
    return {
      textResponse: [
        `Unknown subagent: ${name}`,
        '',
        'Usage: /agent <name> <task>',
        '',
        availableSubagentsLine(profiles),
      ].join('\n'),
    }
  }

  return {
    userMessage,
    commandPrompt: formatAgentCommandPrompt(profile.name, task),
    commandName: 'agent',
  }
}

export async function resolveCommandState(session, userMessage, promptCommand = null) {
  const command = normalizedPromptCommand(promptCommand) || promptCommandFromMessage(userMessage)
  const internalInvocation = internalInvocationForPromptCommand(userMessage, command)
  // /skill and /agent need session context (enabled skills, workspace-rooted
  // agent profiles), so they are resolved here before handleInternalCommand.
  if (internalInvocation?.type === 'skill') return skillCommandState(session, userMessage, internalInvocation.args)
  if (internalInvocation?.type === 'agent') return agentCommandState(session, userMessage, internalInvocation.args)
  const internalResponse = await handleInternalCommand(
    internalInvocation,
    session.projectContext?.workspaceRoot,
    session.projectContext?.project?.commandDir,
  )
  if (typeof internalResponse === 'string') return { textResponse: internalResponse }
  if (internalResponse?.clear) return { clear: internalResponse }
  if (internalResponse?.summary) return { summary: internalResponse }
  if (internalResponse?.compact) return { compact: internalResponse }
  if (internalResponse?.plan) {
    return planCommandState(userMessage, internalResponse.args)
  }
  if (internalResponse?.init) {
    if (!session.projectId) return { textResponse: 'Initialization requires an active project chat.' }
    return {
      userMessage,
      commandPrompt: formatInitCommandPrompt(),
      permissions: { allowEdit: true, allowCommands: true, allowSubagents: true },
      commandName: 'init',
    }
  }
  if (internalResponse?.review) {
    return {
      userMessage,
      commandPrompt: formatReviewCommandPrompt(internalResponse.args),
      permissions: { allowEdit: false, allowCommands: true, allowSubagents: false },
      commandName: 'review',
    }
  }
  if (internalResponse?.commit) {
    return {
      userMessage,
      commandPrompt: formatCommitCommandPrompt(internalResponse.args),
      permissions: { allowEdit: false, allowCommands: true, allowSubagents: false },
      commandName: 'commit',
    }
  }

  if (!session.projectContext?.workspaceRoot) {
    // Even without a project, user-level custom commands (~/.quickforge/commands/) are available
    const invocation = await resolveCustomCommandInvocation(
      userMessage,
      null,
      session.projectContext?.project?.commandDir,
    )
    if (!invocation) return { userMessage }

    return {
      userMessage,
      commandPrompt: invocation.systemPrompt,
      permissions: invocation.permissions,
      commandName: invocation.command.name,
    }
  }

  const invocation = await resolveCustomCommandInvocation(
    userMessage,
    session.projectContext.workspaceRoot,
    session.projectContext.project?.commandDir,
  )
  if (!invocation) return { userMessage }

  return {
    userMessage,
    commandPrompt: invocation.systemPrompt,
    permissions: invocation.permissions,
    commandName: invocation.command.name,
  }
}

function formatInitCommandPrompt() {
  return `<init_command_invocation name="init">
This /init command applies only to the current user request. Work in the current repository root. Inspect the repository as needed, then create or update the root-level \`AGENTS.md\`. If the file already exists, read it first and preserve useful repository-specific guidance while bringing it in line with the requirements below. Do not modify unrelated files.

Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.
</init_command_invocation>`
}

function formatPlanCommandPrompt(task) {
  const taskText = String(task || '').trim()
  return `<plan_command_invocation name="plan">
This /plan command applies only to the current user request. Generate an implementation plan before execution.

Rules for this turn:
- Do not modify files.
- Do not create files.
- Do not run shell commands.
- Do not use write_file, edit_file, run_command, or any other state-changing tool.
- You may use read-only tools such as read_file and grep_files if needed to inspect the project.
- You may delegate bounded read-only research to subagents, but subagents must also obey this /plan turn: no file modifications and no shell commands.
- Output the plan and then stop. Do not start implementation.

Plan should include:
1. Task understanding
2. Relevant files or areas to inspect/change
3. Step-by-step implementation plan
4. Risks or assumptions
5. Validation commands/checks to run after implementation
6. Whether documentation/wiki updates are needed

End by telling the user they can reply “允许”, “按计划执行”, or an equivalent approval phrase to continue in a normal follow-up turn.

User task:
${taskText}
</plan_command_invocation>`
}

function formatCommitCommandPrompt(message) {
  const messageText = String(message || '').trim() || '(none; generate a message from the diff and repository style)'
  return `<commit_command_invocation name="commit">
This /commit command applies only to the current user request. Create at most one local commit for the current task.

Rules for this turn:
- Inspect the current task's Git changes and commit only files related to this task; do not mix in unrelated changes.
- Never use \`git add .\`, \`git add -A\`, or \`git add --all\`; stage only explicit task-related paths.
- Run relevant validation before committing and stop if it fails. Do not modify code, bypass hooks, or alter unrelated changes.
- Create at most one local commit. Do not push, tag, release, publish, or otherwise affect a remote.
- Use the requested message below, or generate one from the diff and repository conventions when none is provided.
- Report the commit hash and message, validations run, and any remaining working tree changes.

Requested commit message:
${messageText}
</commit_command_invocation>`
}

function formatReviewCommandPrompt(scope) {
  const scopeText = String(scope || '').trim() || '(none; review the repository changes that appear relevant for a pre-commit check)'
  return `<review_command_invocation name="review">
This /review command applies only to the current user request. Perform a pre-commit self-review of the code that is about to be committed.

Rules for this turn:
- Do not modify files.
- Do not create files.
- Do not stage, unstage, commit, tag, push, publish, or otherwise change repository state.
- Do not use write_file or edit_file.
- You may use read-only tools and shell commands to inspect the workspace and run validation checks.
- Do not use subagents; perform the review directly in this turn.
- Prefer safe inspection commands such as git status, git diff, git diff --cached, and targeted lint/build/test commands.
- Treat command output as evidence; distinguish confirmed issues from risks or suggestions.

Review checklist:
1. Identify the changes under review, prioritizing staged changes when present and otherwise unstaged working tree changes.
2. Look for correctness bugs, regressions, edge cases, missing error handling, security or privacy risks, and unintended side effects.
3. Check whether tests, lint/build validation, or documentation/wiki updates are needed.
4. Call out any risky commands that should not be run automatically.
5. Output a concise review with severity, file/area, evidence, and recommended next steps. If no blocking issues are found, say so clearly.

User review scope or focus:
${scopeText}
</review_command_invocation>`
}
