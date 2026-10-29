import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogContent,
  FormControl,
  FormGroup,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { useSnackbar } from "notistack";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentToken,
  AgentTokenRequest,
  getAgentTokens,
  sendCreateAgentToken,
  sendRevokeAgentToken,
  sendUpdateAgentToken,
} from "../../../api/api.ts";
import { useAppDispatch } from "../../../redux/hooks.ts";
import { confirmOperation } from "../../../redux/thunks/dialog.ts";
import { copyToClipboard } from "../../../util";
import { PathSelectorForm } from "../../Common/Form/PathSelectorForm.tsx";
import { SecondaryButton, SmallFormControlLabel } from "../../Common/StyledComponents.tsx";
import TimeBadge from "../../Common/TimeBadge.tsx";
import DraggableDialog from "../../Dialogs/DraggableDialog.tsx";
import Add from "../../Icons/Add.tsx";
import Dismiss from "../../Icons/Dismiss.tsx";
import SettingForm from "../Setting/SettingForm.tsx";

const endpoint = () => `${window.location.origin}/api/v4/mcp`;

export function agentConfig(token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        cloudreve: {
          type: "http",
          url: endpoint(),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

const scopeKeys = ["Files.Read", "Files.Write", "Shares.Read", "Shares.Write"];

const scopeI18n: Record<string, string> = {
  "Files.Read": "agentScopeFilesRead",
  "Files.Write": "agentScopeFilesWrite",
  "Shares.Read": "agentScopeSharesRead",
  "Shares.Write": "agentScopeSharesWrite",
};

const describeScopes = (scopes: string[] | undefined, t: (key: string) => string) => {
  if (!scopes || scopes.length === 0) {
    return t("setting.agentScopeFull");
  }
  const parts = scopeKeys
    .filter((key) => scopes.includes(key))
    .filter((key) => !(key.endsWith(".Read") && scopes.includes(`${key.slice(0, -5)}.Write`)));
  if (parts.length === scopeKeys.length) {
    return t("setting.agentScopeFull");
  }
  return parts.map((key) => t(`setting.${scopeI18n[key]}`)).join(" + ");
};

const lifetimeOptions = [604800, 2592000, 7776000, 31536000, 0];
const keepLifetime = -1;
const maxFolders = 5;

const rootDisplay = (root: string) => root.replace(/^cloudreve:\/\/my/, "") || "/";

interface AgentTokenDialogProps {
  open: boolean;
  editTarget?: AgentToken;
  onClose: () => void;
  onCreated: (token: AgentToken) => void;
  onUpdated: () => void;
}

const AgentTokenDialog = ({ open, editTarget, onClose, onCreated, onUpdated }: AgentTokenDialogProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [lifetime, setLifetime] = useState<number>(2592000);
  const [scopes, setScopes] = useState<string[]>([...scopeKeys]);
  const [limitFolder, setLimitFolder] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    if (open && editTarget) {
      setLifetime(keepLifetime);
      setScopes(editTarget.scopes?.length ? [...editTarget.scopes] : [...scopeKeys]);
      setLimitFolder((editTarget.roots?.length ?? 0) > 0);
      setFolders(editTarget.roots?.length ? [...editTarget.roots] : []);
    } else if (open) {
      setLifetime(2592000);
      setScopes([...scopeKeys]);
      setLimitFolder(false);
      setFolders([]);
    }
  }, [open]);

  const toggleScope = (key: string) =>
    setScopes((current) => (current.includes(key) ? current.filter((x) => x !== key) : [...current, key]));

  const updateFolder = (index: number, path: string) =>
    setFolders((current) => current.map((item, i) => (i === index ? path : item)));

  const onAccept = () => {
    const req: AgentTokenRequest = {
      scopes,
      roots: limitFolder ? [...new Set(folders.filter(Boolean))] : [],
    };
    if (!editTarget || lifetime !== keepLifetime) {
      req.ttl_seconds = lifetime;
    }
    setLoading(true);
    const action = editTarget ? sendUpdateAgentToken(editTarget.id, req) : sendCreateAgentToken(req);
    dispatch(action)
      .then((token) => {
        onClose();
        if (editTarget) {
          enqueueSnackbar(t("setting.agentTokenUpdated"));
          onUpdated();
        } else {
          onCreated(token);
        }
      })
      .finally(() => setLoading(false));
  };

  const invalid =
    scopes.length === 0 || (limitFolder && folders.filter(Boolean).length === 0);

  return (
    <DraggableDialog
      title={editTarget ? t("setting.editAgentToken") : t("setting.createAgentToken")}
      showActions
      showCancel
      loading={loading}
      onAccept={onAccept}
      disabled={invalid}
      dialogProps={{
        open,
        onClose,
        fullWidth: true,
        maxWidth: "xs",
        disableRestoreFocus: true,
      }}
    >
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} direction="column">
          <FormControl size="small" fullWidth>
            <InputLabel>{t("setting.agentTokenLifetime")}</InputLabel>
            <Select
              value={lifetime}
              label={t("setting.agentTokenLifetime")}
              onChange={(e) => setLifetime(e.target.value as number)}
            >
              {editTarget && (
                <MenuItem value={keepLifetime}>{t("setting.agentTokenLifetimeKeep")}</MenuItem>
              )}
              {lifetimeOptions.map((seconds) => (
                <MenuItem key={seconds} value={seconds}>
                  {seconds === 0
                    ? t("setting.agentTokenLifetimeNever")
                    : t("setting.agentTokenLifetimeDays", { count: seconds / 86400 })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {editTarget?.expires_cap && (
            <Typography variant="caption" color="text.secondary">
              {t("setting.agentTokenExpiresCap")}
            </Typography>
          )}
          <Box>
            <Typography variant="subtitle2">{t("setting.agentTokenAccess")}</Typography>
            <FormGroup>
              {scopeKeys.map((key) => (
                <Box key={key}>
                  <SmallFormControlLabel
                    control={
                      <Checkbox size="small" checked={scopes.includes(key)} onChange={() => toggleScope(key)} />
                    }
                    label={t(`setting.${scopeI18n[key]}`)}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ pl: "27px", display: "block" }}>
                    {t(`setting.${scopeI18n[key]}Hint`)}
                  </Typography>
                </Box>
              ))}
            </FormGroup>
          </Box>
          <SmallFormControlLabel
            control={
              <Checkbox
                size="small"
                checked={limitFolder}
                onChange={(e) => {
                  setLimitFolder(e.target.checked);
                  if (e.target.checked && folders.length === 0) {
                    setFolders(["cloudreve://my"]);
                  }
                }}
              />
            }
            label={t("setting.agentTokenFolderLimit")}
          />
          {limitFolder && (
            <Stack spacing={1}>
              {folders.map((folder, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <Box sx={{ flex: 1 }}>
                    <PathSelectorForm
                      onChange={(path) => updateFolder(i, path)}
                      path={folder}
                      variant="agentTokenRoot"
                      label={t("setting.agentTokenFolderScope")}
                    />
                  </Box>
                  {folders.length > 1 && (
                    <SecondaryButton onClick={() => setFolders(folders.filter((_, j) => j !== i))}>
                      <Dismiss />
                    </SecondaryButton>
                  )}
                </Stack>
              ))}
              {folders.length < maxFolders && (
                <SecondaryButton
                  startIcon={<Add />}
                  onClick={() => setFolders([...folders, "cloudreve://my"])}
                >
                  {t("setting.agentTokenAddFolder")}
                </SecondaryButton>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
    </DraggableDialog>
  );
};

const McpConnect = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentToken | undefined>();
  const [created, setCreated] = useState<AgentToken | undefined>();

  const reload = () => {
    dispatch(getAgentTokens())
      .then((res) => setTokens(res ?? []))
      .catch(() => setTokens([]));
  };

  useEffect(() => {
    reload();
  }, []);

  const revoke = (id: string) => {
    dispatch(confirmOperation(t("setting.revokeAgentTokenConfirm")))
      .then(() => dispatch(sendRevokeAgentToken(id)))
      .then(() => {
        enqueueSnackbar(t("setting.agentTokenRevoked"));
        reload();
      })
      .catch(() => undefined);
  };



  return (
    <Stack spacing={3} sx={{ mt: 3 }}>
      <SettingForm title={t("setting.mcp")} lgWidth={8}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("setting.mcpDes")}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
          {endpoint()}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <SecondaryButton onClick={() => copyToClipboard(endpoint())}>{t("setting.copyEndpoint")}</SecondaryButton>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              setEditTarget(undefined);
              setDialogOpen(true);
            }}
          >
            {t("setting.createAgentToken")}
          </Button>
        </Stack>
      </SettingForm>

      <SettingForm title={t("setting.agentTokens")} lgWidth={8}>
        {tokens.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("setting.noAgentTokens")}
          </Typography>
        )}
        <Stack spacing={1}>
          {tokens.map((token) => (
            <Stack key={token.id} direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {token.id.slice(0, 8)}
              </Typography>
              {token.expires_at ? (
                <TimeBadge datetime={token.expires_at} variant="body2" />
              ) : (
                <Typography variant="body2">{t("setting.agentTokenLifetimeNever")}</Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                {describeScopes(token.scopes, t)}
              </Typography>
              {(token.roots ?? []).map((root) => (
                <Typography key={root} variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                  {rootDisplay(root)}
                </Typography>
              ))}
              <SecondaryButton
                onClick={() => {
                  setEditTarget(token);
                  setDialogOpen(true);
                }}
              >
                {t("setting.editAgentToken")}
              </SecondaryButton>
              <SecondaryButton startIcon={<Dismiss />} onClick={() => revoke(token.id)}>
                {t("setting.revokeAgentToken")}
              </SecondaryButton>
            </Stack>
          ))}
        </Stack>
      </SettingForm>

      <AgentTokenDialog
        open={dialogOpen}
        editTarget={editTarget}
        onClose={() => setDialogOpen(false)}
        onCreated={(token) => {
          setCreated(token);
          reload();
        }}
        onUpdated={reload}
      />

      <DraggableDialog
        title={t("setting.agentTokenCreated")}
        showActions
        dialogProps={{
          open: !!created,
          onClose: () => setCreated(undefined),
          fullWidth: true,
          maxWidth: "sm",
        }}
        onAccept={() => setCreated(undefined)}
      >
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="warning">{t("setting.agentTokenOnce")}</Alert>
            <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
              {created?.access_token}
            </Typography>
            <SecondaryButton onClick={() => created?.access_token && copyToClipboard(created.access_token)}>
              {t("setting.copyToken")}
            </SecondaryButton>
            <Typography variant="body2" component="pre" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {created?.access_token ? agentConfig(created.access_token) : ""}
            </Typography>
            <SecondaryButton
              onClick={() => created?.access_token && copyToClipboard(agentConfig(created.access_token))}
            >
              {t("setting.copyAgentConfig")}
            </SecondaryButton>
          </Stack>
        </DialogContent>
      </DraggableDialog>
    </Stack>
  );
};

export default McpConnect;
