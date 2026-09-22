import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  Snackbar,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DenseFilledTextField } from "../common/StyledComponent";

type Permission = "view" | "preview" | "edit" | "upload";

interface ExistingShare {
  id: string;
  url: string;
  password_protected: boolean;
  password?: string | null;
  expires?: string | null;
  remain_downloads?: number | null;
  downloaded: number;
  visited: number;
}

const EXPIRE_OPTIONS = [
  { value: 0, label: "never" },
  { value: 3600, label: "oneHour" },
  { value: 86400, label: "oneDay" },
  { value: 604800, label: "sevenDays" },
  { value: 2592000, label: "thirtyDays" },
] as const;

/** Render the cloudreve uri as a readable breadcrumb: My Files / a / b. */
function uriBreadcrumb(uri: string, name: string, t: (k: string) => string) {
  // cloudreve://my/path/to/item -> ["path", "to", "item"]
  const m = uri.match(/^cloudreve:\/\/[^/]+(\/.*)?$/);
  const segs = (m?.[1] ?? "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (segs.length === 0 || segs[segs.length - 1] !== name) {
    if (name) segs.push(name);
  }
  return [t("share.root"), ...segs];
}

export default function Share() {
  const { t } = useTranslation();
  // Windows draws caption buttons via tauri-plugin-frame, macOS via the
  // overlay title bar; only Linux has no native controls to close with.
  const needsCloseButton = platform() === "linux";
  const [params] = useSearchParams();
  const driveId = params.get("drive") ?? "";
  const uri = params.get("uri") ?? "";
  const name = params.get("name") ?? "";
  const isDir = params.get("dir") === "1";

  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<ExistingShare | null>(null);
  const [permission, setPermission] = useState<Permission>("view");
  const [expire, setExpire] = useState<number>(0);
  const [access, setAccess] = useState<"link" | "password">("link");
  const [password, setPassword] = useState("");
  const [downloads, setDownloads] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = existing?.url ?? null;

  useEffect(() => {
    (async () => {
      try {
        const share = await invoke<ExistingShare | null>("get_share", {
          driveId,
          uri,
        });
        if (share) {
          setExisting(share);
          if (share.password_protected) {
            setAccess("password");
            // Prefill so an update without edits keeps the password.
            if (share.password) setPassword(share.password);
          }
          if (share.remain_downloads && share.remain_downloads > 0) {
            setDownloads(String(share.remain_downloads));
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [driveId, uri]);

  const buildOptions = () => ({
    password: access === "password" && password ? password : null,
    downloads: downloads ? parseInt(downloads, 10) : null,
    expire: expire > 0 ? expire : null,
    previewOnly: permission === "preview",
    allowEdit: permission === "edit",
    allowUpload: permission === "upload",
    uploadOnly: permission === "upload",
  });

  const createOrUpdate = async () => {
    setWorking(true);
    setError(null);
    try {
      const options = buildOptions();
      if (existing) {
        await invoke<string>("update_share", {
          driveId,
          shareId: existing.id,
          uri,
          options,
        });
      } else {
        await invoke<string>("create_share", { driveId, uri, options });
      }
      // Re-fetch so `id` and the canonical URL come from the server.
      const share = await invoke<ExistingShare | null>("get_share", {
        driveId,
        uri,
      });
      setExisting(share);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  const removeShare = async () => {
    if (!existing?.id) return;
    setWorking(true);
    setError(null);
    try {
      await invoke("delete_share", { driveId, shareId: existing.id });
      setExisting(null);
      setAccess("link");
      setPassword("");
      setDownloads("");
      setExpire(0);
      setPermission("view");
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
  };

  const crumbs = uriBreadcrumb(uri, name, t);

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Title bar with drag region */}
      <Box
        data-tauri-drag-region
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle1" fontWeight={600} noWrap>
          {t("share.title", { name })}
        </Typography>
        {needsCloseButton && (
          <IconButton
            size="small"
            onClick={() => getCurrentWindow().close()}
            sx={{ WebkitAppRegion: "no-drag", appRegion: "no-drag" }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", px: 3, pb: 2 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {/* Link row - always on top once a share exists (FileCloud style) */}
            {shareUrl && (
              <DenseFilledTextField
                fullWidth
                value={shareUrl}
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={copyLink} title={t("share.copyLink")}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => openUrl(shareUrl)}
                          title={t("share.openLink")}
                          edge="end"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ mt: 1 }}
                onFocus={(e) => e.target.select()}
              />
            )}

            {/* Shared item breadcrumb */}
            <Breadcrumbs
              separator="/"
              sx={{
                mt: 1.5,
                fontSize: 13,
                "& .MuiBreadcrumbs-li": { display: "flex", alignItems: "center", gap: 0.5 },
              }}
            >
              {crumbs.map((seg, i) =>
                i === crumbs.length - 1 ? (
                  <Typography
                    key={i}
                    variant="body2"
                    fontWeight={600}
                    noWrap
                    sx={{ display: "flex", alignItems: "center", gap: 0.5, maxWidth: 220 }}
                  >
                    {isDir ? (
                      <FolderIcon fontSize="small" color="action" />
                    ) : (
                      <InsertDriveFileIcon fontSize="small" color="action" />
                    )}
                    {seg}
                  </Typography>
                ) : (
                  <Link key={i} color="text.secondary" underline="none" variant="body2">
                    {seg}
                  </Link>
                )
              )}
            </Breadcrumbs>

            {/* Access level */}
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
              {t("share.access")}
            </Typography>
            <RadioGroup
              value={access}
              onChange={(e) => setAccess(e.target.value as "link" | "password")}
            >
              <FormControlLabel
                value="link"
                control={<Radio size="small" />}
                label={t("share.accessLink")}
              />
              <FormControlLabel
                value="password"
                control={<Radio size="small" />}
                label={t("share.accessPassword")}
              />
            </RadioGroup>
            {access === "password" && (
              <DenseFilledTextField
                fullWidth
                label={t("share.password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 32 } }}
                sx={{ mt: 0.5 }}
              />
            )}

            {/* Permission level */}
            <DenseFilledTextField
              select
              fullWidth
              label={t("share.permission")}
              value={permission}
              onChange={(e) => setPermission(e.target.value as Permission)}
              sx={{ mt: 2 }}
            >
              <MenuItem value="view">{t("share.permViewDownload")}</MenuItem>
              <MenuItem value="preview">{t("share.permPreviewOnly")}</MenuItem>
              <MenuItem value="edit">{t("share.permAllowEdit")}</MenuItem>
              {isDir && (
                <MenuItem value="upload">{t("share.permUploadOnly")}</MenuItem>
              )}
            </DenseFilledTextField>

            <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
              <DenseFilledTextField
                select
                fullWidth
                label={t("share.expires")}
                value={expire}
                onChange={(e) => setExpire(Number(e.target.value))}
              >
                {EXPIRE_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {t(`share.expire_${o.label}`)}
                  </MenuItem>
                ))}
              </DenseFilledTextField>

              <DenseFilledTextField
                fullWidth
                label={t("share.downloadLimit")}
                type="number"
                value={downloads}
                onChange={(e) => setDownloads(e.target.value)}
                placeholder={t("share.unlimited")}
                slotProps={{ htmlInput: { min: 1 } }}
              />
            </Box>
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 3,
          py: 2,
          display: "flex",
          justifyContent: "space-between",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <Box>
          {existing?.id && (
            <Button color="error" onClick={removeShare} disabled={working}>
              {t("share.removeShare")}
            </Button>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={() => getCurrentWindow().close()}>
            {shareUrl ? t("share.done") : t("share.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={createOrUpdate}
            disabled={working || loading || (access === "password" && !password)}
            startIcon={
              working ? <CircularProgress size={16} color="inherit" /> : null
            }
          >
            {existing ? t("share.modifyLink") : t("share.create")}
          </Button>
        </Box>
      </Box>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={t("share.copied")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
