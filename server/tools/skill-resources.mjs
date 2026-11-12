/**
 * Agent Skill resource tools.
 *
 * loadSkillToolContext resolves the selected global/project skills for a
 * session; activate_skill and read_skill_resource operate on that merged
 * selection. The loader itself lives in server/skills.mjs.
 */
import {
  formatSkillActivation,
  loadSelectedGlobalSkills,
  loadSelectedProjectSkills,
  mergeSkills,
  normalizeSkillNames,
  readSkillResource,
} from '../skills.mjs'
import { truncateText } from '../utils/workspace.mjs'

function activeSkillsForContext(context) {
  return mergeSkills(context?.globalSkills, context?.projectSkills)
}

function activeSkillByName(context, name) {
  const skillName = normalizeSkillNames([name])[0]
  return activeSkillsForContext(context).find((skill) => skill.name === skillName)
}

export async function loadSkillToolContext(config = {}) {
  const globalSkills = await loadSelectedGlobalSkills(config.globalSkillNames)
  const projectSkills = config.workspaceRoot
    ? await loadSelectedProjectSkills(config.projectSkillNames, config.workspaceRoot)
    : []
  return { globalSkills, projectSkills }
}

// --- activate_skill ---
export async function toolActivateSkill(params, context) {
  const skill = activeSkillByName(context, params?.name)
  if (!skill) {
    const error = new Error(`Unknown or disabled skill: ${params?.name || ''}`)
    error.statusCode = 404
    throw error
  }

  return {
    content: truncateText(await formatSkillActivation(skill)),
    details: {
      skill: skill.name,
      source: skill.source,
      directory: skill.rootDir,
    },
  }
}

// --- read_skill_resource ---
export async function toolReadSkillResource(params, context) {
  const skill = activeSkillByName(context, params?.skill)
  if (!skill) {
    const error = new Error(`Unknown or disabled skill: ${params?.skill || ''}`)
    error.statusCode = 404
    throw error
  }

  const result = await readSkillResource(skill, params?.path, params)
  return {
    content: truncateText(result.content),
    details: result.details,
  }
}
