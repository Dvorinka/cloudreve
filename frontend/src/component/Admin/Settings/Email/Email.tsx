import {
  Box,
  DialogContent,
  FormControl,
  FormControlLabel,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useSnackbar } from "notistack";
import { useContext, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { sendTestSMTP } from "../../../../api/api.ts";
import { useAppDispatch } from "../../../../redux/hooks.ts";
import { isTrueVal } from "../../../../session/utils.ts";
import { Code } from "../../../Common/Code.tsx";
import { DefaultCloseAction } from "../../../Common/Snackbar/snackbar.tsx";
import { DenseFilledTextField, DenseSelect, SecondaryButton } from "../../../Common/StyledComponents.tsx";
import DraggableDialog, { StyledDialogContentText } from "../../../Dialogs/DraggableDialog.tsx";
import MailOutlined from "../../../Icons/MailOutlined.tsx";
import { SquareMenuItem } from "../../../FileManager/ContextMenu/ContextMenu.tsx";
import SettingForm from "../../../Pages/Setting/SettingForm.tsx";
import { NoMarginHelperText, SettingSection, SettingSectionContent } from "../Settings.tsx";
import { SettingContext } from "../SettingWrapper.tsx";
import EmailTemplates from "./EmailTemplates.tsx";

const Email = () => {
  const { t } = useTranslation("dashboard");
  const dispatch = useAppDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const { formRef, setSettings, values } = useContext(SettingContext);
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [sending, setSending] = useState(false);

  const isSMTP = (values.mail_driver ?? "smtp") === "smtp";

  const handleTestEmail = async () => {
    setSending(true);
    try {
      await dispatch(
        sendTestSMTP({
          to: testEmailAddress,
          settings: values,
        }),
      );
      enqueueSnackbar({
        message: t("settings.testMailSent"),
        variant: "success",
        action: DefaultCloseAction,
      });
      setTestEmailOpen(false);
    } catch {
    } finally {
      setSending(false);
    }
  };

  return (
    <Box component={"form"} ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <Stack spacing={5}>
        <DraggableDialog
          dialogProps={{
            open: testEmailOpen,
            onClose: () => setTestEmailOpen(false),
          }}
          loading={sending}
          showActions
          showCancel
          onAccept={handleTestEmail}
          title={t("settings.testMailSettings")}
        >
          <DialogContent>
            <StyledDialogContentText sx={{ mb: 2 }}>{t("settings.testMailTooltip")}</StyledDialogContentText>
            <SettingForm title={t("settings.recipient")} lgWidth={12}>
              <DenseFilledTextField
                required
                autoFocus
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                type="email"
                fullWidth
              />
            </SettingForm>
          </DialogContent>
        </DraggableDialog>

        <SettingSection>
          <Typography variant="h6" gutterBottom>
            {t("settings.mail")}
          </Typography>
          <SettingSectionContent>
            <SettingForm title={t("settings.mailDriver")} lgWidth={5}>
              <FormControl>
                <DenseSelect
                  value={values.mail_driver ?? "smtp"}
                  onChange={(e) => setSettings({ mail_driver: e.target.value as string })}
                >
                  <SquareMenuItem value="smtp">
                    <ListItemText slotProps={{ primary: { variant: "body2" } }}>SMTP</ListItemText>
                  </SquareMenuItem>
                  <SquareMenuItem value="http">
                    <ListItemText slotProps={{ primary: { variant: "body2" } }}>
                      {t("settings.mailDriverHTTP")}
                    </ListItemText>
                  </SquareMenuItem>
                </DenseSelect>
                <NoMarginHelperText>{t("settings.mailDriverDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>

            <SettingForm title={t("settings.senderName")} lgWidth={5}>
              <FormControl fullWidth>
                <DenseFilledTextField
                  required
                  value={values.fromName ?? ""}
                  onChange={(e) => setSettings({ fromName: e.target.value })}
                />
                <NoMarginHelperText>{t("settings.senderNameDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>

            <SettingForm title={t("settings.senderAddress")} lgWidth={5}>
              <FormControl fullWidth>
                <DenseFilledTextField
                  type="email"
                  required
                  value={values.fromAdress ?? ""}
                  onChange={(e) => setSettings({ fromAdress: e.target.value })}
                />
                <NoMarginHelperText>{t("settings.senderAddressDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>

            <SettingForm title={t("settings.replyToAddress")} lgWidth={5}>
              <FormControl fullWidth>
                <DenseFilledTextField
                  required
                  value={values.replyTo ?? ""}
                  onChange={(e) => setSettings({ replyTo: e.target.value })}
                />
                <NoMarginHelperText>{t("settings.replyToAddressDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>

            {isSMTP && (
              <>
                <SettingForm title={t("settings.smtpServer")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      required
                      value={values.smtpHost ?? ""}
                      onChange={(e) => setSettings({ smtpHost: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.smtpServerDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.smtpPort")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      type="number"
                      required
                      inputProps={{ min: 1, step: 1 }}
                      value={values.smtpPort ?? ""}
                      onChange={(e) => setSettings({ smtpPort: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.smtpPortDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.smtpUsername")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      required
                      value={values.smtpUser ?? ""}
                      onChange={(e) => setSettings({ smtpUser: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.smtpUsernameDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.smtpPassword")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      type="password"
                      required
                      value={values.smtpPass ?? ""}
                      onChange={(e) => setSettings({ smtpPass: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.smtpPasswordDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm lgWidth={5}>
                  <FormControl fullWidth>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={isTrueVal(values.smtpEncryption)}
                          onChange={(e) => setSettings({ smtpEncryption: e.target.checked ? "1" : "0" })}
                        />
                      }
                      label={t("settings.enforceSSL")}
                    />
                    <NoMarginHelperText>{t("settings.enforceSSLDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.smtpAuthMethod")} lgWidth={5}>
                  <FormControl>
                    <DenseSelect
                      value={values.smtp_auth ?? "autodiscover"}
                      onChange={(e) => setSettings({ smtp_auth: e.target.value as string })}
                    >
                      {[
                        "autodiscover",
                        "plain",
                        "plain-noenc",
                        "login",
                        "login-noenc",
                        "cram-md5",
                        "scram-sha-1",
                        "scram-sha-256",
                        "xoauth2",
                        "noauth",
                      ].map((v) => (
                        <SquareMenuItem key={v} value={v}>
                          <ListItemText
                            slotProps={{
                              primary: { variant: "body2" },
                            }}
                          >
                            {t(`settings.smtpAuth_${v.replace(/-/g, "_")}`)}
                          </ListItemText>
                        </SquareMenuItem>
                      ))}
                    </DenseSelect>
                    <NoMarginHelperText>{t("settings.smtpAuthMethodDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.smtpTTL")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      type="number"
                      required
                      inputProps={{ min: 1, step: 1 }}
                      value={values.mail_keepalive ?? "30"}
                      onChange={(e) => setSettings({ mail_keepalive: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.smtpTTLDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>
              </>
            )}

            {!isSMTP && (
              <>
                <SettingForm title={t("settings.mailHttpEndpoint")} lgWidth={10}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      required
                      value={values.mail_http_endpoint ?? ""}
                      onChange={(e) => setSettings({ mail_http_endpoint: e.target.value })}
                      placeholder="https://mail.example.com/admin/api/v1/mails"
                    />
                    <NoMarginHelperText>
                      <Trans i18nKey="settings.mailHttpEndpointDes" ns="dashboard" components={[<Code key="0" />]} />
                    </NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.mailHttpMethod")} lgWidth={5}>
                  <FormControl>
                    <DenseSelect
                      value={values.mail_http_method ?? "POST"}
                      onChange={(e) => setSettings({ mail_http_method: e.target.value as string })}
                    >
                      {["POST", "PUT", "GET"].map((m) => (
                        <SquareMenuItem key={m} value={m}>
                          <ListItemText slotProps={{ primary: { variant: "body2" } }}>{m}</ListItemText>
                        </SquareMenuItem>
                      ))}
                    </DenseSelect>
                    <NoMarginHelperText>{t("settings.mailHttpMethodDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                <SettingForm title={t("settings.mailHttpHeaders")} lgWidth={10}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      value={values.mail_http_headers ?? ""}
                      onChange={(e) => setSettings({ mail_http_headers: e.target.value })}
                      multiline
                      minRows={2}
                      placeholder={"Authorization: Bearer <token>"}
                    />
                    <NoMarginHelperText>{t("settings.mailHttpHeadersDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>

                {(values.mail_http_method ?? "POST") !== "GET" && (
                  <SettingForm title={t("settings.mailHttpBodyTemplate")} lgWidth={10}>
                    <FormControl fullWidth>
                      <DenseFilledTextField
                        value={values.mail_http_body_tpl ?? ""}
                        onChange={(e) => setSettings({ mail_http_body_tpl: e.target.value })}
                        multiline
                        minRows={4}
                        placeholder={'{"to": "{to}", "from": "{from}", "subject": "{subject}", "html": "{body}"}'}
                      />
                      <NoMarginHelperText>
                        <Trans
                          i18nKey="settings.mailHttpBodyTemplateDes"
                          ns="dashboard"
                          components={[<Code key="0" />]}
                        />
                      </NoMarginHelperText>
                    </FormControl>
                  </SettingForm>
                )}
              </>
            )}

            <Box display="flex" gap={2} mt={2}>
              <SecondaryButton variant="contained" startIcon={<MailOutlined />} onClick={() => setTestEmailOpen(true)}>
                {t("settings.sendTestEmail")}
              </SecondaryButton>
            </Box>
          </SettingSectionContent>
        </SettingSection>

        {/* Email Templates Section */}
        <EmailTemplates />
      </Stack>
    </Box>
  );
};

export default Email;
