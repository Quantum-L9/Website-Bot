export function isInsideRoot(root: string, candidate: string): boolean;

export function walkRoots(
  roots: string[],
  options?: {
    onFile?: (absolutePath: string) => void;
    skipDirNames?: string[];
  },
): { skipped_symlinks: number; skipped_symlink_roots: number };
