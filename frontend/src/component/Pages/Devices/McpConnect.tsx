import { Alert, Button, DialogContent, Stack, Typography } from "@mui/material";
import { useSnackbar } from "notistack";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentToken, getAgentTokens, sendCreateAgentToken, sendRevokeAgentToken } from "../../../api/api.ts";
import { useAppDispatch } from "../../../redux/hooks.ts";
import { confirmOperation } from "../../../redux/thunks/dialog.ts";
import { copyToClipboard } from "../../../util";
import { SecondaryButton } from "../../Common/StyledComponents.tsx";
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

const McpConnect = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<AgentToken | undefined>();

  const reload = () => {
    dispatch(getAgentTokens())
      .then((res) => setTokens(res ?? []))
      .catch(() => setTokens([]));
  };

  useEffect(() => {
    reload();
  }, []);

  const create = () => {
    setLoading(true);
    dispatch(sendCreateAgentToken())
      .then((token) => {
        setCreated(token);
        reload();
      })
      .finally(() => setLoading(false));
  };

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
          <Button variant="contained" startIcon={<Add />} disabled={loading} onClick={create}>
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
            <Stack key={token.id} direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {token.id.slice(0, 8)}
              </Typography>
              <TimeBadge datetime={token.expires_at} variant="body2" />
              <SecondaryButton startIcon={<Dismiss />} onClick={() => revoke(token.id)}>
                {t("setting.revokeAgentToken")}
              </SecondaryButton>
            </Stack>
          ))}
        </Stack>
      </SettingForm>

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
