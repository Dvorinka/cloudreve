import { useMemo } from "react";
import { FileResponse } from "../api/explorer.ts";
import { useAppSelector } from "../redux/hooks.ts";

/// Current page's file list narrowed by the inline list filter
/// (`state.fileManager[i].filter`). Returns the raw list when no filter is set.
export const useFilteredFiles = (fmIndex: number): FileResponse[] | undefined => {
  const files = useAppSelector((state) => state.fileManager[fmIndex]?.list?.files);
  const filter = useAppSelector((state) => state.fileManager[fmIndex]?.filter);
  return useMemo(() => {
    if (!filter || !files) {
      return files;
    }
    const query = filter.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(query));
  }, [files, filter]);
};
