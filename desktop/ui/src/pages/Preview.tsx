import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import FileIcon from "./popup/FileIcon";

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico", "svg",
  "tif", "tiff", "heic", "heif",
]);
const VIDEO_EXTS = new Set([
  "mp4", "webm", "mov", "m4v", "mkv", "avi", "wmv", "flv", "ts", "m2ts", "3gp",
]);
const AUDIO_EXTS = new Set([
  "mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac", "wma",
]);
const TEXT_EXTS = new Set([
  "txt", "text", "md", "markdown", "json", "jsonl", "ndjson", "xml",
  "yaml", "yml", "toml", "ini", "cfg", "conf", "log", "csv", "tsv",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "less",
  "html", "htm", "vue", "svelte", "py", "rs", "go", "java", "kt", "kts",
  "swift", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php", "lua",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "sql", "graphql", "env",
  "gitignore", "dockerfile", "makefile", "cmake", "diff", "patch", "tex",
]);

type PreviewKind = "image" | "video" | "audio" | "text" | "pdf" | "other";

const TEXT_MAX_BYTES = 512 * 1024;

function kindOf(filename: string): PreviewKind {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "other";
  const ext = filename.slice(dot + 1).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (TEXT_EXTS.has(ext)) return "text";
  return "other";
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

interface BodyProps {
  path: string;
  name: string;
  size: number;
  kind: PreviewKind;
  assetUrl: string | null;
  onOpen: () => void;
}

export default function Preview() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const path = params.get("path") ?? "";
  const name =
    params.get("name") ??
    path.split(/[\\/]/).filter(Boolean).pop() ??
    path;
  const size = Number(params.get("size") ?? "0") || 0;

  const kind = useMemo(() => kindOf(name || path), [name, path]);
  const assetUrl = useMemo(
    () => (path ? convertFileSrc(path) : null),
    [path],
  );

  const [error, setError] = useState<string | null>(null);

  const openExternal = async () => {
    try {
      await openPath(path);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <FileIcon path={path || name} size={22} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap title={name}>
            {name}
          </Typography>
          {size > 0 && (
            <Typography variant="caption" color="text.secondary">
              {formatSize(size)}
            </Typography>
          )}
        </Box>
        {path && (
          <Tooltip title={t("preview.openExternal", "Open externally")}>
            <IconButton size="small" onClick={openExternal}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <IconButton
          size="small"
          onClick={() => getCurrentWindow().close()}
          aria-label={t("preview.close", "Close")}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ m: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Content — keyed by path so per-file state resets on reuse */}
      <Box sx={{ flexGrow: 1, minHeight: 0, position: "relative" }}>
        {path ? (
          <PreviewBody
            key={path}
            path={path}
            name={name}
            size={size}
            kind={kind}
            assetUrl={assetUrl}
            onOpen={openExternal}
          />
        ) : (
          <CenteredMessage
            text={t("preview.missingFile", "No file specified")}
          />
        )}
      </Box>
    </Box>
  );
}

function PreviewBody({
  path,
  name,
  size,
  kind,
  assetUrl,
  onOpen,
}: BodyProps) {
  const { t } = useTranslation();
  const [mediaFailed, setMediaFailed] = useState(false);

  const fallback = (reason?: string) => (
    <FallbackCard
      path={path}
      name={name}
      size={size}
      reason={reason}
      onOpen={onOpen}
    />
  );

  if (kind === "other") {
    return fallback(t("preview.unsupported", "No preview available for this file"));
  }
  if (kind === "text") {
    return <TextView path={path} name={name} size={size} onOpen={onOpen} />;
  }
  if (mediaFailed || !assetUrl) {
    return fallback();
  }

  switch (kind) {
    case "image":
      return (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            p: 1,
          }}
        >
          <Box
            component="img"
            src={assetUrl}
            alt={name}
            onError={() => setMediaFailed(true)}
            sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        </Box>
      );
    case "video":
      return (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "black",
            p: 1,
          }}
        >
          <Box
            component="video"
            src={assetUrl}
            controls
            onError={() => setMediaFailed(true)}
            sx={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </Box>
      );
    case "audio":
      return (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            p: 3,
          }}
        >
          <FileIcon path={path} size={64} />
          <Box
            component="audio"
            src={assetUrl}
            controls
            onError={() => setMediaFailed(true)}
            sx={{ width: "100%", maxWidth: 480 }}
          />
          <Typography variant="caption" color="text.secondary" noWrap>
            {name}
          </Typography>
        </Box>
      );
    case "pdf":
      return (
        <Box
          component="iframe"
          src={assetUrl}
          title={name}
          sx={{ width: "100%", height: "100%", border: 0, bgcolor: "white" }}
        />
      );
    default:
      return null;
  }
}

function TextView({
  path,
  name,
  size,
  onOpen,
}: {
  path: string;
  name: string;
  size: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; text: string }
    | { status: "error"; error: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    invoke<string>("read_text_file", { path, maxBytes: TEXT_MAX_BYTES })
      .then((text) => {
        if (!cancelled) setState({ status: "ok", text });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state.status === "loading") {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (state.status === "error") {
    return (
      <FallbackCard
        path={path}
        name={name}
        size={size}
        reason={state.error}
        onOpen={onOpen}
      />
    );
  }
  return (
    <Box
      component="pre"
      sx={{
        height: "100%",
        m: 0,
        p: 2,
        overflow: "auto",
        fontFamily: "monospace",
        fontSize: 12,
        whiteSpace: "pre",
        wordBreak: "normal",
        overflowWrap: "normal",
        bgcolor: "background.paper",
      }}
    >
      {state.text}
      {size > TEXT_MAX_BYTES && (
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 2 }}
        >
          {t("preview.truncated", "Showing the first {{size}} of the file", {
            size: formatSize(TEXT_MAX_BYTES),
          })}
        </Typography>
      )}
    </Box>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Box>
  );
}

function FallbackCard({
  path,
  name,
  size,
  reason,
  onOpen,
}: {
  path: string;
  name: string;
  size: number;
  reason?: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        bgcolor: "background.default",
      }}
    >
      <FileIcon path={path} size={96} />
      <Box sx={{ textAlign: "center", maxWidth: "80%" }}>
        <Typography variant="subtitle2" noWrap title={name}>
          {name}
        </Typography>
        {size > 0 && (
          <Typography variant="caption" color="text.secondary">
            {formatSize(size)}
          </Typography>
        )}
        {reason && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
          >
            {reason}
          </Typography>
        )}
      </Box>
      <Button variant="contained" size="small" onClick={onOpen}>
        {t("preview.openExternal", "Open externally")}
      </Button>
    </Box>
  );
}
