import { FilterListOutlined } from "@mui/icons-material";
import { IconButton, InputAdornment, useMediaQuery, useTheme } from "@mui/material";
import { useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { setListFilter } from "../../../redux/fileManagerSlice.ts";
import { setSearchPopup, setSearchPopupKeyword } from "../../../redux/globalStateSlice.ts";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks.ts";
import { OutlineIconTextField } from "../../Common/Form/OutlineIconTextField.tsx";
import Dismiss from "../../Icons/Dismiss.tsx";
import { FmIndexContext } from "../FmIndexContext.tsx";

/// Inline quick filter for the file list: narrows the current page by name
/// substring as you type. `/` focuses the field, Esc clears it.
const ListFilter = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const fmIndex = useContext(FmIndexContext);
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.fileManager[fmIndex].filter);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key == "/" && !target.closest("input, textarea, [contenteditable='true']")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <OutlineIconTextField
      inputRef={inputRef}
      variant="outlined"
      size="small"
      icon={<FilterListOutlined fontSize="small" />}
      placeholder={t("application:fileManager.filterList")}
      value={filter ?? ""}
      onChange={(e) => dispatch(setListFilter({ index: fmIndex, value: e.target.value }))}
      onKeyDown={(e) => {
        if (e.key == "Escape") {
          if (filter) {
            e.stopPropagation();
            dispatch(setListFilter({ index: fmIndex, value: undefined }));
          } else {
            inputRef.current?.blur();
          }
        } else if (e.key == "Enter" && filter) {
          // Escalate to full search — the inline filter is page-local.
          dispatch(setSearchPopupKeyword(filter));
          dispatch(setSearchPopup(true));
        }
      }}
      InputProps={{
        endAdornment: filter ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              edge="end"
              aria-label={t("application:fileManager.clearFilter")}
              onClick={() => dispatch(setListFilter({ index: fmIndex, value: undefined }))}
            >
              <Dismiss fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : undefined,
        sx: { fontSize: theme.typography.body2.fontSize },
      }}
      sx={{
        my: "auto",
        ml: "auto",
        width: isMobile ? 110 : 160,
        "& .MuiOutlinedInput-notchedOutline": { border: "none" },
      }}
    />
  );
};

export default ListFilter;
