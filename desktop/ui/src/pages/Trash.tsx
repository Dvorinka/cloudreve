import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Close as CloseIcon,
  DeleteForever as DeleteForeverIcon,
  DeleteOutline as TrashIcon,
  Restore as RestoreIcon,
} from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DriveConfig } from "./popup/types";

type TrashFile = {
  type: number;
  id: string;
  name: string;
  path: string;
  size: number;
  created_at: string;
  updated_at: string;
};

type TrashResponse = {
  files: TrashFile[];
};

const PAGE_SIZE = 200;

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function Trash() {
  const { t } = useTranslation();
  const [drive, setDrive] = useState<DriveConfig | null>(null);
  const [drives, setDrives] = useState<DriveConfig[]>([]);
  const [files, setFiles] = useState<TrashFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const refresh = useCallback(async (d: DriveConfig) => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<TrashResponse>("list_trash_files", {
        driveId: d.id,
        page: 1,
        pageSize: PAGE_SIZE,
      });
      setFiles(res.files);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const all = await invoke<DriveConfig[]>("list_drives");
        setDrives(all);
        const first = all[0] ?? null;
        setDrive(first);
        if (first) {
          await refresh(first);
        } else {
          setLoading(false);
        }
      } catch (e) {
        setError(String(e));
        setLoading(false);
      }
    })();
  }, [refresh]);

  const selectDrive = useCallback(
    (id: string) => {
      const next = drives.find((d) => d.id === id) ?? null;
      setDrive(next);
      if (next) {
        refresh(next);
      }
    },
    [drives, refresh],
  );

  const emptyTrash = useCallback(async () => {
    if (!drive) return;
    const confirmed = await ask(
      t("trash.emptyConfirm", {
        defaultValue: "Permanently delete every item in the trash? This cannot be undone.",
      }),
      { title: t("trash.emptyTrash"), kind: "warning" },
    );
    if (!confirmed) return;
    setEmptying(true);
    try {
      await invoke("empty_trash", { driveId: drive.id });
      setFiles([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setEmptying(false);
    }
  }, [drive, t]);

  const act = useCallback(
    async (file: TrashFile, command: "restore_files" | "delete_files_permanently") => {
      if (!drive) return;
      if (command === "delete_files_permanently") {
        const confirmed = await ask(
          t("trash.deleteForeverConfirm", {
            name: file.name,
            defaultValue: `Permanently delete "${file.name}"? This cannot be undone.`,
          }),
          { title: t("trash.deleteForever"), kind: "warning" },
        );
        if (!confirmed) return;
      }
      setBusy(file.id);
      try {
        await invoke(command, { driveId: drive.id, uris: [file.path] });
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [drive, t],
  );

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        p: 2,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
        <TrashIcon sx={{ color: "text.secondary" }} />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t("trash.title")}
        </Typography>
        {drives.length > 1 && drive && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select
              value={drive.id}
              onChange={(e) => selectDrive(e.target.value)}
              aria-label={t("trash.drive", "Drive")}
            >
              {drives.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {files.length > 0 && (
          <Button
            size="small"
            color="error"
            disabled={emptying}
            onClick={emptyTrash}
          >
            {t("trash.emptyTrash", "Empty trash")}
          </Button>
        )}
        <IconButton
          size="small"
          onClick={() => getCurrentWindow().close()}
          aria-label={t("trash.close", "Close")}
        >
          <CloseIcon />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : files.length === 0 ? (
        <Box sx={{ textAlign: "center", mt: 6, color: "text.secondary" }}>
          <TrashIcon sx={{ fontSize: 40, mb: 1, opacity: 0.5 }} />
          <Typography variant="body2">{t("trash.empty")}</Typography>
        </Box>
      ) : (
        <List dense sx={{ flexGrow: 1, overflowY: "auto" }}>
          {files.map((file) => (
            <ListItem
              key={file.id}
              disableGutters
              secondaryAction={
                <Box>
                  <Tooltip title={t("trash.restore")}>
                    <span>
                      <IconButton
                        edge="end"
                        size="small"
                        disabled={busy === file.id}
                        onClick={() => act(file, "restore_files")}
                      >
                        <RestoreIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("trash.deleteForever")}>
                    <span>
                      <IconButton
                        edge="end"
                        size="small"
                        disabled={busy === file.id}
                        onClick={() => act(file, "delete_files_permanently")}
                      >
                        <DeleteForeverIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              }
            >
              <ListItemText
                primary={file.name}
                secondary={`${formatSize(file.size)} • ${new Date(file.updated_at).toLocaleDateString()}`}
                primaryTypographyProps={{ noWrap: true }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
