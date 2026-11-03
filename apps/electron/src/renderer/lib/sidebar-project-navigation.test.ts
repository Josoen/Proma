import { expect, test } from 'bun:test'
import { getActiveSessionProject, getFallbackProject } from './sidebar-project-navigation'

test('Given 归档历史 When 聚焦 Then 不选择归档项目，默认项目仍可作新建目标', () => {
  const projects = [
    { id: 'archived', name: '历史', slug: 'history', archived: true, createdAt: 1, updatedAt: 1 },
    { id: 'default', name: '默认', slug: 'default', createdAt: 1, updatedAt: 1 },
  ]
  expect(getActiveSessionProject({ id: 's', title: 's', workspaceId: 'archived', createdAt: 1, updatedAt: 1 }, projects)).toBeUndefined()
  expect(getFallbackProject(projects)?.id).toBe('default')
})
