import {
  Alert,
  Button,
  Checkbox,
  DialogContent,
  FormControl,
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

const scopeRead = "Files.Read";
const scopeFilesWrite = "Files.Write";
const scopeSharesWrite = "Shares.Write";

const accessScopes: Record<string, string[]> = {
  read: [scopeRead],
  write: [scopeFilesWrite],
  full: [scopeFilesWrite, scopeSharesWrite],
};

const accessFromScopes = (scopes?: string[]) => {
  if (!scopes || scopes.length === 0 || scopes.includes(scopeSharesWrite)) {
    return "full";
  }
  if (scopes.includes(scopeFilesWrite)) {
    return "write";
  }
  return "read";
};

const lifetimeOptions = [604800, 2592000, 7776000, 31536000, 0];
const keepLifetime = -1;

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
  const [access, setAccess] = useState("full");
  const [limitFolder, setLimitFolder] = useState(false);
  const [folder, setFolder] = useState("cloudreve://my");

  useEffect(() => {
    if (open && editTarget) {
      setLifetime(keepLifetime);
      setAccess(accessFromScopes(editTarget.scopes));
      setLimitFolder((editTarget.roots?.length ?? 0) > 0);
      setFolder(editTarget.roots?.[0] ?? "cloudreve://my");
    } else if (open) {
      setLifetime(2592000);
      setAccess("full");
      setLimitFolder(false);
      setFolder("cloudreve://my");
    }
  }, [open]);

  const onAccept = () => {
    const req: AgentTokenRequest = {
      scopes: accessScopes[access],
      roots: limitFolder ? [folder] : [],
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

  return (
    <DraggableDialog
      title={editTarget ? t("setting.editAgentToken") : t("setting.createAgentToken")}
      showActions
      showCancel
      loading={loading}
      onAccept={onAccept}
      disabled={limitFolder && !folder}
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
          <FormControl size="small" fullWidth>
            <InputLabel>{t("setting.agentTokenAccess")}</InputLabel>
            <Select
              value={access}
              label={t("setting.agentTokenAccess")}
              onChange={(e) => setAccess(e.target.value)}
            >
              <MenuItem value="read">{t("setting.agentTokenAccessRead")}</MenuItem>
              <MenuItem value="write">{t("setting.agentTokenAccessWrite")}</MenuItem>
              <MenuItem value="full">{t("setting.agentTokenAccessFull")}</MenuItem>
            </Select>
          </FormControl>
          <SmallFormControlLabel
            control={
              <Checkbox size="small" checked={limitFolder} onChange={(e) => setLimitFolder(e.target.checked)} />
            }
            label={t("setting.agentTokenFolderLimit")}
          />
          {limitFolder && (
            <PathSelectorForm
              onChange={setFolder}
              path={folder}
              variant="agentTokenRoot"
              label={t("setting.agentTokenFolderScope")}
            />
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

  const accessLabel = (token: AgentToken) => {
    const key = accessFromScopes(token.scopes);
    return t(`setting.agentTokenAccess${key[0].toUpperCase()}${key.slice(1)}`);
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
                {accessLabel(token)}
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
