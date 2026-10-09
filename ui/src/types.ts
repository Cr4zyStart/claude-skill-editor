export type RootKind = 'user' | 'project' | 'repo' | 'plugin' | 'custom'

export type RootGroup = 'yours' | 'editable' | 'installed'

export interface Root {
  id: string
  label: string
  detail: string
  group: RootGroup
  dir: string
  kind: RootKind
  writable: boolean
  loaded: boolean
  skillCount: number
  duplicateCount: number
}

export interface SkillSummary {
  dir: string
  rootId: string
  rootLabel: string
  rootKind: RootKind
  writable: boolean
  loaded: boolean
  folder: string
  relative: string
  name: string
  description: string
}

export interface SkillFile {
  path: string
  relative: string
  size: number
  editable: boolean
}

export interface Issue {
  level: 'error' | 'warn'
  code: string
  message: string
  hint?: string
}

export interface Validation {
  issues: Issue[]
  errors: number
  warnings: number
}

export interface Skill {
  dir: string
  folder: string
  rootId: string
  rootLabel: string
  rootKind: RootKind
  writable: boolean
  loaded: boolean
  fields: Record<string, string>
  extraLines: string[]
  body: string
  files: SkillFile[]
  validation: Validation
}

export interface RecentEntry {
  dir: string
  name: string
  rootLabel: string
  writable: boolean
  at: string
}

export interface AppState {
  apiVersion: number
  projectDir: string
  roots: Root[]
  skills: SkillSummary[]
}
