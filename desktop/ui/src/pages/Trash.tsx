import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
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
  const [files, setFiles] = useState<TrashFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
        const drives = await invoke<DriveConfig[]>("list_drives");
        const first = drives[0] ?? null;
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

  const act = useCallback(
    async (file: TrashFile, command: "restore_files" | "delete_files_permanently") => {
      if (!drive) return;
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
    [drive],
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
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <TrashIcon sx={{ mr: 1, color: "text.secondary" }} />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t("trash.title")}
        </Typography>
        <IconButton size="small" onClick={() => getCurrentWindow().close()}>
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
