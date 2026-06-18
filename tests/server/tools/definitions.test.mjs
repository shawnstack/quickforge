import { describe, it, expect } from 'vitest'
import { subagentTool, workspaceTools, createSkillTools } from '../../../server/tools/definitions.mjs'

describe('definitions', () => {
  describe('subagentTool', () => {
    it('has correct name', () => {
      expect(subagentTool.name).toBe('run_subagent')
    })

    it('has a label', () => {
      expect(subagentTool.label).toBeTruthy()
    })

    it('has a description', () => {
      expect(subagentTool.description).toBeTruthy()
      expect(typeof subagentTool.description).toBe('string')
    })

    it('prioritizes explore for repository discovery', () => {
      expect(subagentTool.description).toContain('Prefer explore')
      expect(subagentTool.description).toContain('locating files')
      expect(subagentTool.description).toContain('tracing call chains')
      expect(subagentTool.description).toContain('related tests/docs/wiki pages')
      expect(subagentTool.description).toContain('impact analysis')
      expect(subagentTool.description).toContain('Use general for bounded complex multi-step implementation')
    })

    it('has parameters with subagent and task', () => {
      const props = subagentTool.parameters.properties
      expect(props).toHaveProperty('subagent')
      expect(props).toHaveProperty('task')
    })
  })

  describe('workspaceTools', () => {
    it('is an array', () => {
      expect(Array.isArray(workspaceTools)).toBe(true)
    })

    it('includes all expected tool names', () => {
      const names = workspaceTools.map((t) => t.name)
      expect(names).toContain('run_subagent')
      expect(names).toContain('read_file')
      expect(names).toContain('grep_files')
      expect(names).toContain('write_file')
      expect(names).toContain('edit_file')
      expect(names).toContain('run_command')
    })

    it('has exactly 6 tools', () => {
      expect(workspaceTools).toHaveLength(6)
    })

    it('each tool has name, label, description, and parameters', () => {
      for (const tool of workspaceTools) {
        expect(tool.name).toBeTruthy()
        expect(tool.label).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.parameters).toBeTruthy()
      }
    })

    it('write_file has executionMode sequential', () => {
      const wf = workspaceTools.find((t) => t.name === 'write_file')
      expect(wf.executionMode).toBe('sequential')
    })

    it('edit_file has executionMode sequential', () => {
      const ef = workspaceTools.find((t) => t.name === 'edit_file')
      expect(ef.executionMode).toBe('sequential')
    })

    it('run_command has executionMode sequential', () => {
      const rc = workspaceTools.find((t) => t.name === 'run_command')
      expect(rc.executionMode).toBe('sequential')
    })

    it('read_file has path parameter', () => {
      const rf = workspaceTools.find((t) => t.name === 'read_file')
      expect(rf.parameters.properties).toHaveProperty('path')
    })

    it('grep_files has query parameter', () => {
      const gf = workspaceTools.find((t) => t.name === 'grep_files')
      expect(gf.parameters.properties).toHaveProperty('query')
    })

    it('edit_file has oldText and newText parameters', () => {
      const ef = workspaceTools.find((t) => t.name === 'edit_file')
      expect(ef.parameters.properties).toHaveProperty('oldText')
      expect(ef.parameters.properties).toHaveProperty('newText')
    })
  })

  describe('createSkillTools', () => {
    it('returns empty array when no skills are configured', async () => {
      // Mock: no workspace root → no project skills, no global skill names
      const result = await createSkillTools()
      expect(result).toEqual([])
    })
  })
})
