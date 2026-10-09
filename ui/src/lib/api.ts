import type { AppState, RecentEntry, Skill } from '@/types'

export const API_VERSION = 2
const TOKEN = document.body.dataset.token ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'x-editor-token': TOKEN,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Bad response from server: ${text.slice(0, 160)}`)
  }
  if (res.status === 403) {
    throw new Error(
      'The server rejected this page (403). It was most likely restarted with a new token — refresh the page.',
    )
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error
    throw new Error(message ?? `HTTP ${res.status}`)
  }
  return data as T
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  token: TOKEN,

  async state(): Promise<AppState> {
    const state = await request<AppState>('/api/state')
    if (state.apiVersion !== API_VERSION) {
      throw new Error(
        `This page needs API v${API_VERSION}, but the server is speaking v${
          state.apiVersion || 1
        }. It is still running older code: stop it with Ctrl+C and start it again.`,
      )
    }
    return state
  },

  skill: (dir: string, remember = true) =>
    request<Skill>(`/api/skill?dir=${encodeURIComponent(dir)}${remember ? '' : '&remember=0'}`),

  file: (path: string) =>
    request<{ path: string; text: string }>(`/api/file?path=${encodeURIComponent(path)}`),

  recent: () => request<{ recent: RecentEntry[] }>('/api/recent'),

  clearRecent: () => post<{ recent: RecentEntry[] }>('/api/clear-recent', {}),

  saveSkill: (payload: {
    dir: string
    fields: Record<string, string>
    extraLines: string[]
    body: string
  }) => post<Skill>('/api/save-skill', payload),

  saveFile: (path: string, text: string) =>
    post<{ ok: boolean }>('/api/save-file', { path, text }),

  newSkill: (payload: { rootId: string; folder: string; description: string }) =>
    post<Skill>('/api/new-skill', payload),

  forkSkill: (payload: { dir: string; targetRootId: string; folder: string }) =>
    post<Skill>('/api/fork-skill', payload),

  newFile: (dir: string, relative: string) =>
    post<Skill>('/api/new-file', { dir, relative }),

  addRoot: (dir: string, label?: string) => post<{ dir: string }>('/api/add-root', { dir, label }),

  removeRoot: (dir: string) => post<{ ok: boolean }>('/api/remove-root', { dir }),

  validateAll: () =>
    post<{ results: { dir: string; errors: number; warnings: number }[] }>('/api/validate-all', {}),
}
