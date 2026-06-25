import { getDirectoryIcon, getFileIcon } from './file-icon-utils'

export function FileIcon({ path, className = 'size-3.5' }: { path: string; className?: string }) {
  const { Icon, className: color } = getFileIcon(path)
  return <Icon className={`${color} ${className}`} />
}

export function DirectoryIcon({ name, open, className = 'size-3.5' }: { name: string; open: boolean; className?: string }) {
  const { Icon, className: color } = getDirectoryIcon(name, open)
  return <Icon className={`${color} ${className}`} />
}
