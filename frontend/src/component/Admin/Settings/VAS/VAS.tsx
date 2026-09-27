import { Box, FormControl, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { isTrueVal } from "../../../../session/utils.ts";
import { DenseFilledTextField } from "../../../Common/StyledComponents.tsx";
import SettingForm from "../../../Pages/Setting/SettingForm.tsx";
import { NoMarginHelperText, SettingSection, SettingSectionContent } from "../Settings.tsx";
import { SettingContext } from "../SettingWrapper.tsx";
import GiftCodes from "./GiftCodes.tsx";
import ManualCreditAdjust from "./ManualCreditAdjust.tsx";
import SkuTable from "./SkuTable.tsx";
const VAS = () => {
  const { t } = useTranslation("dashboard");
  const { formRef, setSettings, values } = useContext(SettingContext);
  return (
    <Box component={"form"} ref={formRef}>
      <Stack spacing={5}>
        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("settings.creditAndVAS")}
          </Typography>
          <SettingSectionContent>
            <Stack spacing={2}>
              <SettingForm title={t("settings.shareScoreRate")} lgWidth={5}>
                <FormControl fullWidth>
                  <DenseFilledTextField
                    type="number"
                    value={values.share_score_rate ?? "100"}
                    slotProps={{ htmlInput: { min: 0, max: 100 } }}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0)));
                      setSettings({ share_score_rate: v.toString() });
                    }}
                  />
                  <NoMarginHelperText>{t("settings.shareScoreRateDes")}</NoMarginHelperText>
                </FormControl>
              </SettingForm>
            </Stack>

            <SettingForm lgWidth={5}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={isTrueVal(values.shop_nav ?? "1")}
                      onChange={(e) => setSettings({ shop_nav: e.target.checked ? "1" : "0" })}
                    />
                  }
                  label={t("settings.shopNavEnabled")}
                />
                <NoMarginHelperText>{t("settings.shopNavEnabledDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("settings.paymentStripe")}
          </Typography>
          <SettingSectionContent>
            <SettingForm lgWidth={5}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={isTrueVal(values.payment_stripe_enabled ?? "0")}
                      onChange={(e) => setSettings({ payment_stripe_enabled: e.target.checked ? "1" : "0" })}
                    />
                  }
                  label={t("settings.paymentStripeEnabled")}
                />
                <NoMarginHelperText>{t("settings.paymentStripeEnabledDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>
            {isTrueVal(values.payment_stripe_enabled ?? "0") && (
              <>
                <SettingForm title={t("settings.paymentStripePublishableKey")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      value={values.payment_stripe_publishable_key ?? ""}
                      onChange={(e) => setSettings({ payment_stripe_publishable_key: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.paymentStripePublishableKeyDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>
                <SettingForm title={t("settings.paymentStripeSecretKey")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      type="password"
                      value={values.payment_stripe_secret_key ?? ""}
                      placeholder={t("settings.secretKeepHint")}
                      onChange={(e) => setSettings({ payment_stripe_secret_key: e.target.value })}
                    />
                    <NoMarginHelperText>{t("settings.paymentStripeSecretKeyDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>
                <SettingForm title={t("settings.paymentStripeWebhookSecret")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      type="password"
                      value={values.payment_stripe_webhook_secret ?? ""}
                      placeholder={t("settings.secretKeepHint")}
                      onChange={(e) => setSettings({ payment_stripe_webhook_secret: e.target.value })}
                    />
                    <NoMarginHelperText>
                      {t("settings.paymentStripeWebhookSecretDes", {
                        url: `${window.location.origin}/api/v4/callback/stripe`,
                      })}
                    </NoMarginHelperText>
                  </FormControl>
                </SettingForm>
                <SettingForm title={t("settings.paymentStripeCurrency")} lgWidth={5}>
                  <FormControl fullWidth>
                    <DenseFilledTextField
                      value={values.payment_stripe_currency ?? "usd"}
                      onChange={(e) => setSettings({ payment_stripe_currency: e.target.value.trim().toLowerCase() })}
                    />
                    <NoMarginHelperText>{t("settings.paymentStripeCurrencyDes")}</NoMarginHelperText>
                  </FormControl>
                </SettingForm>
              </>
            )}
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("settings.storageProductSettings")}
          </Typography>
          <SettingSectionContent>
            <SettingForm lgWidth={12}>
              <FormControl fullWidth>
                <SkuTable type="storage" />
                <NoMarginHelperText>{t("settings.storageProductsDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("settings.groupProductSettings")}
          </Typography>
          <SettingSectionContent>
            <SettingForm lgWidth={12}>
              <FormControl fullWidth>
                <SkuTable type="group" />
                <NoMarginHelperText>{t("settings.groupProductsDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("settings.trafficProductSettings")}
          </Typography>
          <SettingSectionContent>
            <SettingForm lgWidth={12}>
              <FormControl fullWidth>
                <SkuTable type="traffic" />
                <NoMarginHelperText>{t("settings.trafficProductsDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("settings.streamTrafficProductSettings")}
          </Typography>
          <SettingSectionContent>
            <SettingForm lgWidth={12}>
              <FormControl fullWidth>
                <SkuTable type="stream_traffic" />
                <NoMarginHelperText>{t("settings.streamTrafficProductsDes")}</NoMarginHelperText>
              </FormControl>
            </SettingForm>
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("giftCodes.giftCodesSettings")}
          </Typography>
          <SettingSectionContent>
            <GiftCodes />
          </SettingSectionContent>
        </SettingSection>

        <SettingSection>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center" }}>
            {t("vas.manualAdjust")}
          </Typography>
          <SettingSectionContent>
            <ManualCreditAdjust />
          </SettingSectionContent>
        </SettingSection>
      </Stack>
    </Box>
  );
};

export default VAS;
