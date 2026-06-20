import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Resolve a node type to its CSS variable color, e.g. var(--node-concept). */
export function nodeColorVar(nodeType: string): string {
  return `var(--node-${nodeType ?? 'chunk'})`;
}

/** Shared className for native <select> elements (NodeInspector, EdgeInspector). */
export const SELECT_CLASSNAME =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';
