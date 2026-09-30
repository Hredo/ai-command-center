/**
 * Las secciones de la app, en el orden del menú. Las usan el menú lateral, los
 * atajos Ctrl+1..9 y la paleta de comandos.
 */
import type React from 'react'
import {
  LayoutDashboard, MessageSquare, Swords, FolderGit2, Bot, Boxes, History, Settings2, TerminalSquare, Home,
  SquareKanban
} from 'lucide-react'
import type { PageId } from './nav'

export const SECTIONS: { id: PageId; icon: React.ElementType; group: number }[] = [
  { id: 'dashboard', icon: LayoutDashboard, group: 0 },
  { id: 'chat', icon: MessageSquare, group: 0 },
  { id: 'arena', icon: Swords, group: 0 },
  { id: 'terminal', icon: TerminalSquare, group: 0 },
  { id: 'tasks', icon: SquareKanban, group: 0 },
  { id: 'projects', icon: FolderGit2, group: 1 },
  { id: 'agents', icon: Bot, group: 1 },
  { id: 'models', icon: Boxes, group: 1 },
  { id: 'house', icon: Home, group: 1 },
  { id: 'history', icon: History, group: 2 },
  { id: 'settings', icon: Settings2, group: 2 }
]

/** El atajo de una sección: Ctrl+1..9 las nueve primeras y Ctrl+, Ajustes. */
export function sectionShortcut(id: PageId): string | undefined {
  if (id === 'settings') return 'Ctrl+,'
  const i = SECTIONS.findIndex((s) => s.id === id)
  return i >= 0 && i < 9 ? `Ctrl+${i + 1}` : undefined
}
