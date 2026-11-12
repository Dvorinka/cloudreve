import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Divider,
  IconButton,
  List,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
  Folder as FolderIcon,
  SyncAlt as SyncAltIcon,
} from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatusSummary } from "./popup/types";
import DriveChips from "./popup/DriveChips";
import TaskItem from "./popup/TaskItem";
import ConflictItem from "./popup/ConflictItem";

export default function Transfers() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<StatusSummary | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchSummary = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const result = await invoke<StatusSummary>("get_status_summary", {
        driveId: selectedDrive,
      });
      setSummary(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      isFetchingRef.current = false;
    }
  }, [selectedDrive]);

  useEffect(() => {
    fetchSummary();
    const intervalId = setInterval(fetchSummary, 1000);
    return () => clearInterval(intervalId);
  }, [fetchSummary]);

  const handleAddDrive = async () => {
    try {
      await invoke("show_add_drive_window");
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCancel = async (driveId: string, path: string) => {
    try {
      await invoke("cancel_transfer", { driveId, path });
      fetchSummary();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleResolveAll = async (action: "keep_remote" | "overwrite_remote") => {
    try {
      await invoke("resolve_all_conflicts", {
        driveId: selectedDrive,
        action,
      });
      fetchSummary();
    } catch (e) {
      setError(String(e));
    }
  };

  const hasActiveTasks =
    summary?.active_tasks && summary.active_tasks.length > 0;
  const hasFinishedTasks =
    summary?.finished_tasks && summary.finished_tasks.length > 0;
  const hasPendingConflicts =
    summary?.pending_conflicts && summary.pending_conflicts.length > 0;
  const isEmpty = !hasPendingConflicts && !hasActiveTasks && !hasFinishedTasks;

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SyncAltIcon sx={{ color: "text.secondary" }} />
            <Typography variant="h6">{t("transfers.title", "Transfers")}</Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => getCurrentWindow().close()}
            aria-label={t("popup.close", "Close")}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <DriveChips
          drives={summary?.drives ?? []}
          selectedDrive={selectedDrive}
          onDriveSelect={setSelectedDrive}
          onAddDrive={handleAddDrive}
        />
      </Box>

      {error && (
        <Alert severity="error" sx={{ m: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Task list */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {isEmpty ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              gap: 1,
            }}
          >
            <FolderIcon sx={{ fontSize: 48, color: "text.disabled" }} />
            <Typography variant="body2" color="text.secondary">
              {t("popup.noActivity", "No recent activity")}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {/* Pending conflicts */}
            {hasPendingConflicts && (
              <>
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    pb: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Typography
                    variant="caption"
                    color="warning.main"
                    sx={{ fontWeight: 700, textTransform: "uppercase" }}
                  >
                    {t("popup.conflicts", "Conflicts")}
                  </Typography>
                  <ButtonGroup size="small" variant="text" color="warning">
                    <Button onClick={() => handleResolveAll("keep_remote")}>
                      {t("popup.keepAllRemote", "Keep all remote")}
                    </Button>
                    <Button onClick={() => handleResolveAll("overwrite_remote")}>
                      {t("popup.overwriteAllRemote", "Overwrite all remote")}
                    </Button>
                  </ButtonGroup>
                </Box>
                {summary?.pending_conflicts.map((conflict) => (
                  <ConflictItem
                    key={conflict.id}
                    conflict={conflict}
                    onResolved={fetchSummary}
                  />
                ))}
              </>
            )}

            {hasPendingConflicts && (hasActiveTasks || hasFinishedTasks) && (
              <Divider sx={{ my: 1 }} />
            )}

            {/* Active transfers */}
            {hasActiveTasks && (
              <>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    px: 2,
                    py: 1,
                    pb: 0,
                    display: "block",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  {t("popup.syncing", "Syncing")}
                </Typography>
                {summary?.active_tasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isActive
                    action={
                      <Tooltip title={t("transfers.cancel", "Cancel")}>
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => handleCancel(task.drive_id, task.local_path)}
                        >
                          <CancelIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                  />
                ))}
              </>
            )}

            {hasActiveTasks && hasFinishedTasks && <Divider sx={{ my: 1 }} />}

            {/* Recent transfers */}
            {hasFinishedTasks && (
              <>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    px: 2,
                    py: 1,
                    pb: 0,
                    display: "block",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  {t("popup.recent", "Recent")}
                </Typography>
                {summary?.finished_tasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </>
            )}
          </List>
        )}
      </Box>

      {/* Footer status */}
      <Box
        sx={{
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        {hasActiveTasks ? (
          <SyncAltIcon sx={{ fontSize: 18, color: "primary.main" }} />
        ) : hasPendingConflicts ? (
          <FolderIcon sx={{ fontSize: 18, color: "warning.main" }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 18, color: "success.main" }} />
        )}
        <Typography variant="caption" color="text.secondary">
          {hasActiveTasks
            ? t("popup.syncingStatus", "Syncing {{count}} file(s)...", {
                count: summary?.active_tasks.length ?? 0,
              })
            : hasPendingConflicts
              ? t("popup.conflictStatus", "{{count}} conflict(s) need attention", {
                  count: summary?.pending_conflicts.length ?? 0,
                })
              : t("popup.upToDate", "Your files are up to date")}
        </Typography>
      </Box>
    </Box>
  );
}
