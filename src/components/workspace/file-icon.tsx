import { getDirectoryIconName, getFileIconName } from './file-icon-utils'
import { directoryIconUrls, fileIconUrls } from './file-icon-assets'

type IconImageProps = {
  className?: string
}

function IconImage({ src, className = 'size-3.5' }: IconImageProps & { src: string }) {
  return <img src={src} alt="" aria-hidden="true" draggable={false} className={className} />
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  return <IconImage src={fileIconUrls[getFileIconName(path)]} className={className} />
}

export function DirectoryIcon({ name, open, className }: { name: string; open: boolean; className?: string }) {
  return <IconImage src={directoryIconUrls[getDirectoryIconName(name, open)]} className={className} />
}
