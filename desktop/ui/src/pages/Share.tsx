import {
  Alert,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
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
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FolderIcon from "@mui/icons-material/Folder";
import GroupIcon from "@mui/icons-material/Group";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PersonIcon from "@mui/icons-material/Person";
import PublicIcon from "@mui/icons-material/Public";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DenseFilledTextField } from "../common/StyledComponent";

// Permission presets over the server's four boolean flags. "viewup" is
// preview-only + upload: visitors can browse and add files but cannot
// download. Upload-shaped presets are folder-only in the UI.
type Permission = "view" | "preview" | "viewup" | "updown" | "upload" | "edit";

interface ExistingShare {
  id: string;
  url: string;
  password_protected: boolean;
  password?: string | null;
  expires?: string | null;
  remain_downloads?: number | null;
  downloaded: number;
  visited: number;
  slug?: string | null;
  preview_only?: boolean;
  allow_edit?: boolean;
  allow_upload?: boolean;
  upload_only?: boolean;
}

const EXPIRE_OPTIONS = [
  { value: 0, label: "never" },
  { value: 3600, label: "oneHour" },
  { value: 86400, label: "oneDay" },
  { value: 604800, label: "sevenDays" },
  { value: 2592000, label: "thirtyDays" },
] as const;

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{2,63}$/;

// ACL rows carry the server's named permission bits; labels in the UI use
// the share dialog's vocabulary (view/upload/edit/delete).
const ACL_PERMS = ["read", "create", "update", "delete"] as const;
type AclPerm = (typeof ACL_PERMS)[number];

interface AclEntry {
  id: number;
  subject_type: "user" | "group" | "anonymous" | "everyone";
  subject_id: number;
  subject_name?: string | null;
  permissions: string[];
}

interface AclSubject {
  subject_type?: string;
  type?: string;
  id: number;
  name: string;
}

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: "block", lineHeight: 1.6 }}
    >
      {children}
    </Typography>
  );
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
  const [editingLink, setEditingLink] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [aclEntries, setAclEntries] = useState<AclEntry[]>([]);
  const [aclOptions, setAclOptions] = useState<AclSubject[]>([]);
  const [aclKeyword, setAclKeyword] = useState("");
  const [aclBusy, setAclBusy] = useState<number | "add" | null>(null);
  const [aclError, setAclError] = useState<string | null>(null);

  const shareUrl = existing?.url ?? null;
  // "https://host/s/" — the fixed part of the link shown while editing.
  const linkPrefix = useMemo(() => {
    if (!shareUrl) return "";
    const i = shareUrl.indexOf("/s/");
    return i >= 0 ? shareUrl.slice(0, i + 3) : shareUrl;
  }, [shareUrl]);

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
          // Restore the permission selector from the live share flags.
          if (share.upload_only) setPermission("upload");
          else if (share.allow_edit) setPermission("edit");
          else if (share.allow_upload && share.preview_only)
            setPermission("viewup");
          else if (share.allow_upload) setPermission("updown");
          else if (share.preview_only) setPermission("preview");
          // Expiry: snap remaining seconds to the closest option.
          if (share.expires) {
            const secs = Math.max(
              0,
              Math.floor(
                (new Date(share.expires).getTime() - Date.now()) / 1000,
              ),
            );
            const best = EXPIRE_OPTIONS.reduce((a, b) =>
              Math.abs(b.value - secs) < Math.abs(a.value - secs) ? b : a,
            );
            setExpire(best.value);
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [driveId, uri]);

  // Load the file's ACL (selected users/groups). Failures surface in the
  // section only — the group may simply lack permission management.
  useEffect(() => {
    (async () => {
      try {
        const entries = await invoke<AclEntry[]>("list_acl", { driveId, uri });
        setAclEntries(entries);
      } catch (e) {
        setAclError(String(e));
      }
    })();
  }, [driveId, uri]);

  // Debounced subject search; anonymous/everyone are always offered when
  // not already granted — they are link-scope tiers, not stored subjects.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<AclSubject[]>("search_acl_subjects", {
          driveId,
          keyword: aclKeyword,
        });
        const dynamic = (res ?? [])
          .filter(
            (s) =>
              !aclEntries.some(
                (e) =>
                  e.subject_type === (s.subject_type ?? s.type) &&
                  e.subject_id === s.id,
              ),
          )
          .map((s) => ({
            ...s,
            type: s.subject_type ?? s.type,
          }));
        const fixed = (["anonymous", "everyone"] as const)
          .filter((ty) => !aclEntries.some((e) => e.subject_type === ty))
          .filter(
            (ty) =>
              aclKeyword === "" ||
              t(`share.acl_${ty}`).toLowerCase().includes(aclKeyword.toLowerCase()),
          )
          .map((ty) => ({ type: ty, id: 0, name: t(`share.acl_${ty}`) }));
        setAclOptions([...dynamic, ...fixed]);
      } catch {
        setAclOptions([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [aclKeyword, aclEntries, driveId, t]);

  const buildOptions = () => ({
    password: access === "password" && password ? password : null,
    downloads: downloads ? parseInt(downloads, 10) : null,
    expire: expire > 0 ? expire : null,
    previewOnly: permission === "preview" || permission === "viewup",
    allowEdit: permission === "edit",
    allowUpload:
      permission === "updown" ||
      permission === "upload" ||
      permission === "viewup",
    uploadOnly: permission === "upload",
  });

  const refresh = async () => {
    const share = await invoke<ExistingShare | null>("get_share", {
      driveId,
      uri,
    });
    setExisting(share);
  };

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
      await refresh();
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
      setEditingLink(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  const startEditLink = () => {
    setSlugDraft(existing?.slug ?? "");
    setSlugError(null);
    setEditingLink(true);
  };

  const saveLink = async () => {
    if (!existing?.id) return;
    const slug = slugDraft
      .trim()
      .toLowerCase()
      .replace(/^\/+/, "")
      .replace(/^s\//, "");
    if (slug && !SLUG_PATTERN.test(slug)) {
      setSlugError(t("share.slugInvalid"));
      return;
    }
    if (slug === (existing.slug ?? "")) {
      setEditingLink(false);
      return;
    }
    setWorking(true);
    setSlugError(null);
    try {
      // `slug` rides the normal update: "" clears, a value sets it.
      await invoke("update_share", {
        driveId,
        shareId: existing.id,
        uri,
        options: { ...buildOptions(), slug },
      });
      await refresh();
      setEditingLink(false);
    } catch (e) {
      setSlugError(String(e));
    } finally {
      setWorking(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
  };

  const aclSubjectLabel = (e: AclEntry) => {
    if (e.subject_type === "anonymous" || e.subject_type === "everyone") {
      return t(`share.acl_${e.subject_type}`);
    }
    return e.subject_name || `#${e.subject_id}`;
  };

  const upsertAcl = async (
    subjectType: string,
    subjectId: number,
    permissions: string[],
  ): Promise<AclEntry> =>
    invoke<AclEntry>("upsert_acl", {
      driveId,
      uri,
      subjectType,
      subjectId,
      permissions,
    });

  const addAclSubject = async (subject: AclSubject | null) => {
    if (!subject) return;
    setAclBusy("add");
    setAclError(null);
    try {
      const entry = await upsertAcl(
        subject.type ?? subject.subject_type ?? "user",
        subject.id,
        ["read"],
      );
      setAclEntries((prev) => [...prev, { ...entry, subject_name: subject.name }]);
      setAclKeyword("");
    } catch (e) {
      setAclError(String(e));
    } finally {
      setAclBusy(null);
    }
  };

  const toggleAclPerm = async (entry: AclEntry, perm: AclPerm) => {
    const next = entry.permissions.includes(perm)
      ? entry.permissions.filter((p) => p !== perm)
      : [...entry.permissions, perm];
    setAclBusy(entry.id);
    setAclError(null);
    try {
      const res = await upsertAcl(entry.subject_type, entry.subject_id, next);
      setAclEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, permissions: res.permissions } : e)),
      );
    } catch (e) {
      setAclError(String(e));
    } finally {
      setAclBusy(null);
    }
  };

  const removeAclEntry = async (entry: AclEntry) => {
    setAclBusy(entry.id);
    setAclError(null);
    try {
      await invoke("delete_acl", { driveId, uri, id: entry.id });
      setAclEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (e) {
      setAclError(String(e));
    } finally {
      setAclBusy(null);
    }
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
            {/* Share link — FileCloud-style top row with Modify link */}
            {shareUrl && (
              <Box sx={{ mt: 0.5 }}>
                <SectionLabel>{t("share.shareLink")}</SectionLabel>
                {editingLink ? (
                  <DenseFilledTextField
                    fullWidth
                    autoFocus
                    value={slugDraft}
                    onChange={(e) => {
                      setSlugDraft(e.target.value);
                      setSlugError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveLink();
                      if (e.key === "Escape") setEditingLink(false);
                    }}
                    error={!!slugError}
                    helperText={slugError ?? t("share.slugHint")}
                    placeholder={t("share.slugPlaceholder")}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                              sx={{ maxWidth: 180 }}
                            >
                              {linkPrefix}
                            </Typography>
                          </InputAdornment>
                        ),
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={saveLink}
                              disabled={working}
                              title={t("share.saveLink")}
                            >
                              <CheckIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => setEditingLink(false)}
                              disabled={working}
                              title={t("share.cancel")}
                              edge="end"
                            >
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                    sx={{ mt: 0.5 }}
                  />
                ) : (
                  <DenseFilledTextField
                    fullWidth
                    value={shareUrl}
                    slotProps={{
                      input: {
                        readOnly: true,
                        endAdornment: (
                          <InputAdornment position="end" sx={{ gap: 0.5 }}>
                            <Button
                              size="small"
                              onClick={startEditLink}
                              sx={{
                                textTransform: "none",
                                minWidth: 0,
                                px: 1,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {t("share.modifyLink")}
                            </Button>
                            <Divider orientation="vertical" flexItem />
                            <IconButton
                              size="small"
                              onClick={copyLink}
                              title={t("share.copyLink")}
                            >
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
                    sx={{ mt: 0.5 }}
                    onFocus={(e) => e.target.select()}
                  />
                )}
                {existing && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    {t("share.stats", {
                      views: existing.visited,
                      downloads: existing.downloaded,
                    })}
                  </Typography>
                )}
              </Box>
            )}

            {/* Shared item */}
            <Box sx={{ mt: 2 }}>
              <SectionLabel>{t("share.sharedItem")}</SectionLabel>
              <Breadcrumbs
                separator="/"
                sx={{
                  fontSize: 13,
                  "& .MuiBreadcrumbs-li": {
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  },
                }}
              >
                {crumbs.map((seg, i) =>
                  i === crumbs.length - 1 ? (
                    <Typography
                      key={i}
                      variant="body2"
                      fontWeight={600}
                      noWrap
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        maxWidth: 220,
                      }}
                    >
                      {isDir ? (
                        <FolderIcon fontSize="small" color="action" />
                      ) : (
                        <InsertDriveFileIcon fontSize="small" color="action" />
                      )}
                      {seg}
                    </Typography>
                  ) : (
                    <Link
                      key={i}
                      color="text.secondary"
                      underline="none"
                      variant="body2"
                    >
                      {seg}
                    </Link>
                  ),
                )}
              </Breadcrumbs>
            </Box>

            {/* Sharing permissions */}
            <Box sx={{ mt: 2 }}>
              <SectionLabel>{t("share.access")}</SectionLabel>
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
            </Box>

            <DenseFilledTextField
              select
              fullWidth
              label={t("share.allow")}
              value={permission}
              onChange={(e) => setPermission(e.target.value as Permission)}
              sx={{ mt: 2 }}
            >
              <MenuItem value="preview">{t("share.permViewOnly")}</MenuItem>
              <MenuItem value="view">{t("share.permViewDownload")}</MenuItem>
              {isDir && (
                <MenuItem value="viewup">{t("share.permViewUpload")}</MenuItem>
              )}
              {isDir && (
                <MenuItem value="updown">
                  {t("share.permUploadDownload")}
                </MenuItem>
              )}
              {isDir && (
                <MenuItem value="upload">{t("share.permUploadOnly")}</MenuItem>
              )}
              {isDir && (
                <MenuItem value="edit">{t("share.permAllowEdit")}</MenuItem>
              )}
            </DenseFilledTextField>

            {/* Selected users and groups — file ACL, bypasses the link
                password for authenticated visitors */}
            <Box sx={{ mt: 2 }}>
              <SectionLabel>{t("share.aclSection")}</SectionLabel>
              <Autocomplete
                size="small"
                options={aclOptions}
                inputValue={aclKeyword}
                onInputChange={(_, v) => setAclKeyword(v)}
                getOptionLabel={(o) => o.name}
                getOptionKey={(o) => `${o.type ?? o.subject_type}:${o.id}`}
                onChange={(_, v) => addAclSubject(v)}
                value={null}
                blurOnSelect
                loading={aclBusy === "add"}
                renderOption={(props, o) => (
                  <li {...props} key={`${o.type ?? o.subject_type}:${o.id}`}>
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 1 }}
                    >
                      {(o.type ?? o.subject_type) === "user" ? (
                        <PersonIcon fontSize="small" />
                      ) : (o.type ?? o.subject_type) === "group" ? (
                        <GroupIcon fontSize="small" />
                      ) : (
                        <PublicIcon fontSize="small" />
                      )}
                      {o.name}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <DenseFilledTextField
                    {...params}
                    placeholder={t("share.aclSearch")}
                    variant="filled"
                  />
                )}
              />
              {aclEntries.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  {aclEntries.map((e) => (
                    <Box
                      key={e.id}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        py: 0.25,
                      }}
                    >
                      {e.subject_type === "user" ? (
                        <PersonIcon fontSize="small" color="action" />
                      ) : e.subject_type === "group" ? (
                        <GroupIcon fontSize="small" color="action" />
                      ) : (
                        <PublicIcon fontSize="small" color="action" />
                      )}
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ flex: 1, minWidth: 0 }}
                      >
                        {aclSubjectLabel(e)}
                      </Typography>
                      {ACL_PERMS.map((p) => (
                        <FormControlLabel
                          key={p}
                          control={
                            <Checkbox
                              size="small"
                              checked={e.permissions.includes(p)}
                              disabled={aclBusy === e.id}
                              onChange={() => toggleAclPerm(e, p)}
                            />
                          }
                          label={
                            <Typography variant="caption">
                              {t(`share.aclPerm_${p}`)}
                            </Typography>
                          }
                          sx={{ mr: 0.5, ml: 0 }}
                        />
                      ))}
                      <IconButton
                        size="small"
                        disabled={aclBusy === e.id}
                        onClick={() => removeAclEntry(e)}
                        title={t("share.aclRemove")}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
              {aclError && (
                <Typography
                  variant="caption"
                  color="error"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {aclError}
                </Typography>
              )}
            </Box>

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
            {existing ? t("share.save") : t("share.create")}
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
