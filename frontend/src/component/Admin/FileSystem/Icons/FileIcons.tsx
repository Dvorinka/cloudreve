import { Box, Stack, Typography } from "@mui/material";
import { useSnackbar } from "notistack";
import { useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "../../../../redux/hooks";
import { SettingSection, SettingSectionContent } from "../../Settings/Settings";
import { SettingContext } from "../../Settings/SettingWrapper";
import EmojiList from "./EmojiList";
import FileIconList from "./FileIconList";

const FileIcons = () => {
  const { t } = useTranslation("dashboard");
  const { formRef, setSettings, values } = useContext(SettingContext);
  const [_loading, _setLoading] = useState(false);
  const _dispatch = useAppDispatch();
  const { enqueueSnackbar: _enqueueSnackbar } = useSnackbar();

  const iconOnChange = useCallback(
    (s: string) =>
      setSettings({
        explorer_icons: s,
      }),
    [],
  );

  const onEmojiChange = useCallback(
    (s: string) =>
      setSettings({
        emojis: s,
      }),
    [],
  );

  return (
    <Box component={"form"} ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <Stack spacing={5}>
        <SettingSection>
          <Typography variant="h6" gutterBottom>
            {t("settings.fileIcons")}
          </Typography>
          <SettingSectionContent>
            <FileIconList config={values.explorer_icons} onChange={iconOnChange} />
          </SettingSectionContent>
        </SettingSection>
        <SettingSection>
          <Typography variant="h6" gutterBottom>
            {t("settings.emojiOptions")}
          </Typography>
          <SettingSectionContent>
            <EmojiList config={values.emojis} onChange={onEmojiChange} />
          </SettingSectionContent>
        </SettingSection>
      </Stack>
    </Box>
  );
};

export default FileIcons;
