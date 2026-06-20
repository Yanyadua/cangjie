import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Resolve a node type to its CSS variable color, e.g. var(--node-concept). */
export function nodeColorVar(nodeType: string): string {
  return `var(--node-${nodeType ?? 'chunk'})`;
}
