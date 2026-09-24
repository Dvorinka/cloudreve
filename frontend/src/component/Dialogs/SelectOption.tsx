import { useTranslation } from "react-i18next";
import { Checkbox, DialogContent, DialogContentText, FormControlLabel, List, ListItemButton, ListItemText } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../redux/hooks.ts";
import React, { useCallback } from "react";
import DraggableDialog from "./DraggableDialog.tsx";
import { selectOptionDialogPromisePool } from "../../redux/thunks/dialog.ts";
import { closeSelectOptionDialog, setSelectOptionRememberChecked } from "../../redux/globalStateSlice.ts";

const SelectOption = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const open = useAppSelector((state) => state.globalState.selectOptionDialogOpen);
  const title = useAppSelector((state) => state.globalState.selectOptionTitle);
  const promiseId = useAppSelector((state) => state.globalState.selectOptionPromiseId);
  const subtitle = useAppSelector((state) => state.globalState.selectOptionSubtitle);
  const options = useAppSelector((state) => state.globalState.selectOptionDialogOptions);
  const rememberable = useAppSelector((state) => state.globalState.selectOptionRememberable);
  const rememberChecked = useAppSelector((state) => state.globalState.selectOptionRememberChecked);

  const onClose = useCallback(() => {
    dispatch(closeSelectOptionDialog());
    if (promiseId) {
      selectOptionDialogPromisePool[promiseId]?.reject("cancel");
    }
  }, [dispatch, promiseId]);

  const onAccept = useCallback(
    (v: any) => {
      dispatch(closeSelectOptionDialog());
      if (promiseId) {
        selectOptionDialogPromisePool[promiseId]?.resolve(
          rememberable ? { value: v, remember: !!rememberChecked } : v,
        );
      }
    },
    [promiseId, rememberable, rememberChecked],
  );

  return (
    <DraggableDialog
      title={t(title ?? "")}
      dialogProps={{
        open: open ?? false,
        onClose: onClose,
        maxWidth: "sm",
      }}
    >
      <DialogContent>
        {subtitle && <DialogContentText sx={{ mb: 1 }}>{subtitle}</DialogContentText>}
        <List component="nav">
          {options?.map((o) => (
            <ListItemButton key={o.value} disabled={o.disabled} onClick={() => onAccept(o.value)}>
              <ListItemText
                primary={o.name}
                secondary={o.description}
                slotProps={{
                  primary: {
                    variant: "body2",
                    fontWeight: "bold",
                  },

                  secondary: { variant: "body2" },
                }}
              />
            </ListItemButton>
          ))}
        </List>
        {rememberable && (
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={!!rememberChecked}
                onChange={(e) => dispatch(setSelectOptionRememberChecked(e.target.checked))}
              />
            }
            label={t("modals.dontAskAgain")}
          />
        )}
      </DialogContent>
    </DraggableDialog>
  );
};
export default SelectOption;
