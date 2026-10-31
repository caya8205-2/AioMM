import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Add01Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckIcon,
  CodeIcon,
  Delete02Icon,
  ExternalLinkIcon,
  File01Icon,
  Folder01Icon,
  Folder02Icon,
  Image01Icon,
  KeyboardIcon,
  Layers01Icon,
  Refresh01Icon,
  Search01Icon,
  SlidersHorizontalIcon,
  Undo02Icon,
} from '@hugeicons/core-free-icons';

export const Icons = {
  add: Add01Icon,
  alert: Alert02Icon,
  info: AlertCircleIcon,
  chevronDown: ArrowDown01Icon,
  arrowLeft: ArrowLeft01Icon,
  chevronRight: ArrowRight01Icon,
  close: Cancel01Icon,
  check: CheckIcon,
  code: CodeIcon,
  trash: Delete02Icon,
  external: ExternalLinkIcon,
  file: File01Icon,
  folder: Folder01Icon,
  folderOpen: Folder02Icon,
  image: Image01Icon,
  keyboard: KeyboardIcon,
  layers: Layers01Icon,
  refresh: Refresh01Icon,
  search: Search01Icon,
  sliders: SlidersHorizontalIcon,
  undo: Undo02Icon,
} as const;

interface IconProps {
  icon: IconSvgElement;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ icon, size = 18, strokeWidth = 1.6, className }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={className}
    />
  );
}
