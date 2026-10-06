import {
  Autocomplete,
  Checkbox,
  Collapse,
  createFilterOptions,
  Divider,
  FormControl,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  styled,
  TextField,
  Typography,
} from "@mui/material";
import MuiAccordion from "@mui/material/Accordion";
import MuiAccordionDetails from "@mui/material/AccordionDetails";
import MuiAccordionSummary from "@mui/material/AccordionSummary";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { FileResponse, FileType } from "../../../../api/explorer.ts";
import { Code } from "../../../Common/Code.tsx";
import { FilledTextField, SmallFormControlLabel } from "../../../Common/StyledComponents.tsx";
import BookInformation from "../../../Icons/BookInformation.tsx";
import ChevronRight from "../../../Icons/ChevronRight.tsx";
import ClockArrowDownload from "../../../Icons/ClockArrowDownload.tsx";
import CoinStack from "../../../Icons/CoinStack.tsx";
import Eye from "../../../Icons/Eye.tsx";
import Globe from "../../../Icons/Globe.tsx";
import RenameOutlined from "../../../Icons/RenameOutlined.tsx";
import SettingsOutlined from "../../../Icons/SettingsOutlined.tsx";
import TableSettingsOutlined from "../../../Icons/TableSettings.tsx";
import Timer from "../../../Icons/Timer.tsx";

const Accordion = styled(MuiAccordion)(() => ({
  border: "0px solid rgba(0, 0, 0, .125)",
  boxShadow: "none",
  "&:not(:last-child)": {
    borderBottom: 0,
  },
  "&:before": {
    display: "none",
  },
  ".Mui-expanded": {
    margin: "0 0",
    minHeight: 0,
  },
  "&.Mui-expanded": {
    margin: "0 0",
    minHeight: 0,
  },
}));

const AccordionSummary = styled(MuiAccordionSummary)(({ theme }) => ({
  padding: 0,
  "& .MuiAccordionSummary-content": {
    margin: 0,
    display: "initial",
    "&.Mui-expanded": {
      margin: "0 0",
    },
  },
  "&.Mui-expanded": {
    borderRadius: "12px 12px 0 0",
    backgroundColor: theme.palette.mode == "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.09)",
    minHeight: "0px!important",
  },
}));

const AccordionDetails = styled(MuiAccordionDetails)(({ theme }) => ({
  padding: 24,
  backgroundColor: theme.palette.mode == "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.09)",
  borderRadius: "0 0 12px 12px",
  fontSize: theme.typography.body2.fontSize,
  color: theme.palette.text.secondary,
}));

const StyledListItemButton = styled(ListItemButton)(() => ({}));

const SectionLabel = styled(Typography)(({ theme }) => ({
  padding: theme.spacing(1, 2, 0.5),
  color: theme.palette.text.secondary,
}));

export interface ShareSetting {
  is_private?: boolean;
  use_custom_password?: boolean;
  password?: string;
  share_view?: boolean;
  show_readme?: boolean;
  hide_readme?: boolean;
  allow_upload?: boolean;
  allow_edit?: boolean;
  preview_only?: boolean;
  upload_only?: boolean;
  note?: string;
  listed_publicly?: boolean;
  slug?: string;
  use_custom_link?: boolean;
  downloads?: boolean;
  expires?: boolean;
  price_points?: number;

  downloads_val: valueOption;
  expires_val: valueOption;
}

export interface ShareSettingProps {
  setting: ShareSetting;
  file?: FileResponse;
  onSettingChange: (value: ShareSetting) => void;
  editing?: boolean;
}

interface valueOption {
  value: number;
  label: string;
  inputValue?: string;
}

export const expireOptions: valueOption[] = [
  { value: 300, label: "modals.5minutes" },
  { value: 3600, label: "modals.1hour" },
  { value: 24 * 3600, label: "modals.1day" },
  { value: 7 * 24 * 3600, label: "modals.7days" },
  { value: 30 * 24 * 3600, label: "modals.30days" },
];

export const downloadOptions: valueOption[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
];

const neverOption: valueOption = { value: 0, label: "modals.never" };

type AccessRole = "view" | "preview" | "upload" | "edit" | "dropbox";

const isNumeric = (num: any) =>
  (typeof num === "number" || (typeof num === "string" && num.trim() !== "")) && !isNaN(num as number);

const filter = createFilterOptions<valueOption>();

const ShareSettingContent = ({ setting, file, editing, onSettingChange }: ShareSettingProps) => {
  const { t } = useTranslation();

  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [advancedToggled, setAdvancedToggled] = useState<boolean | undefined>(undefined);

  const isFolder = file?.type == FileType.folder;
  const isFile = file?.type == FileType.file;

  const handleExpand = (panel: string) => (_event: any, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : undefined);
  };

  const handleCheck =
    (
      prop:
        | "is_private"
        | "share_view"
        | "show_readme"
        | "listed_publicly"
        | "use_custom_link",
    ) =>
    () => {
      if (!setting[prop]) {
        handleExpand(prop)(null, true);
      }

      onSettingChange({
        ...setting,
        [prop]: !setting[prop],
        // Unchecking the custom-link box drops the entered slug so the
        // update clears it server-side.
        ...(prop === "use_custom_link" && setting[prop] ? { slug: "" } : {}),
      });
    };

  // Access role folds the mutually exclusive permission flags into one
  // Drive-style dropdown. Priority mirrors flag precedence. Folder-only
  // flags restored from storage on a non-folder target display as "view"
  // (the flag itself is preserved, as before).
  const rawRole: AccessRole = setting.upload_only
    ? "dropbox"
    : setting.allow_edit
      ? "edit"
      : setting.allow_upload
        ? "upload"
        : setting.preview_only
          ? "preview"
          : "view";
  const role: AccessRole = !isFolder && rawRole !== "view" && rawRole !== "preview" ? "view" : rawRole;

  const setRole = (value: AccessRole) => {
    onSettingChange({
      ...setting,
      preview_only: value === "preview" || undefined,
      allow_upload: value === "upload" || value === "edit" || undefined,
      allow_edit: value === "edit" || undefined,
      upload_only: value === "dropbox" || undefined,
    });
  };

  const roleDes: Record<AccessRole, string> = {
    view: t("application:modals.accessRoleViewerDes"),
    preview: t("application:modals.previewOnlyDes"),
    upload: t("application:modals.allowUploadDes"),
    edit: t("application:modals.allowEditDes"),
    dropbox: t("application:modals.uploadOnlyDes"),
  };

  const advancedSummary = [
    setting.use_custom_link ? t("application:modals.customLink") : undefined,
    setting.note ? t("application:modals.shareNote") : undefined,
    setting.price_points ? t("application:modals.paidShare") : undefined,
    setting.listed_publicly ? t("application:modals.publicListing") : undefined,
    setting.downloads ? t("application:modals.expireAfterDownload") : undefined,
    setting.share_view ? t("application:modals.shareView") : undefined,
    setting.show_readme ? t("application:modals.showReadme") : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  // Auto-open the additional section when a loaded/restored setting already
  // carries one of its options; an explicit user toggle wins.
  const advancedOpen = advancedToggled ?? !!advancedSummary;

  return (
    <>
      <SectionLabel variant="subtitle2">{t("application:modals.accessSection")}</SectionLabel>
      <List sx={{ padding: 0 }}>
        <StyledListItemButton disableRipple sx={{ cursor: "default", gap: 1, flexWrap: "wrap" }}>
          <ListItemIcon>
            <Globe />
          </ListItemIcon>
          <ListItemText
            primary={t("application:modals.anyoneWithLink")}
            primaryTypographyProps={{ noWrap: true }}
            sx={{ flex: "1 1 auto", minWidth: 0 }}
          />
          <Select
            variant="standard"
            disableUnderline
            size="small"
            value={role}
            onChange={(e) => setRole(e.target.value as AccessRole)}
            sx={{ flexShrink: 0, ml: "64px" }}
          >
            <MenuItem value="view">{t("application:modals.accessRoleViewer")}</MenuItem>
            <MenuItem value="preview">{t("application:modals.previewOnly")}</MenuItem>
            {isFolder && [
              <MenuItem key="upload" value="upload">
                {t("application:modals.accessRoleUploader")}
              </MenuItem>,
              <MenuItem key="edit" value="edit">
                {t("application:modals.accessRoleEditor")}
              </MenuItem>,
              <MenuItem key="dropbox" value="dropbox">
                {t("application:modals.uploadOnly")}
              </MenuItem>,
            ]}
          </Select>
          <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%", pl: "64px" }}>
            {roleDes[role]}
          </Typography>
        </StyledListItemButton>
        <Accordion expanded={expanded === "is_private"} onChange={handleExpand("is_private")}>
          <AccordionSummary aria-controls="panel1a-content" id="panel1a-header">
            <StyledListItemButton>
              <ListItemIcon>
                <Eye />
              </ListItemIcon>
              <ListItemText primary={t("application:modals.privateShare")} />
              <ListItemSecondaryAction>
                <Checkbox disabled={editing} checked={!!setting.is_private} onChange={handleCheck("is_private")} />
              </ListItemSecondaryAction>
            </StyledListItemButton>
          </AccordionSummary>
          <AccordionDetails sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Typography variant="body2">{t("application:modals.privateShareDes")}</Typography>
            {setting.is_private && (
              <Stack sx={{ mt: 1, width: "100%" }}>
                {!editing && (
                  <SmallFormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={setting.use_custom_password}
                        onChange={() => {
                          onSettingChange({ ...setting, use_custom_password: !setting.use_custom_password });
                        }}
                      />
                    }
                    label={t("application:modals.useCustomPassword")}
                  />
                )}
                <Collapse in={setting.use_custom_password}>
                  <FormControl variant="standard" fullWidth sx={{ mt: 1 }}>
                    <FilledTextField
                      label={t("application:modals.sharePassword")}
                      disabled={editing}
                      slotProps={{
                        htmlInput: {
                          maxLength: 32,
                        },
                      }}
                      value={setting.password ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (!/^[a-zA-Z0-9]*$/.test(value) || value.length > 32) return;
                        onSettingChange({ ...setting, password: value });
                      }}
                      required
                    />
                  </FormControl>
                </Collapse>
              </Stack>
            )}
          </AccordionDetails>
        </Accordion>
        <StyledListItemButton disableRipple sx={{ cursor: "default", gap: 1 }}>
          <ListItemIcon>
            <Timer />
          </ListItemIcon>
          <ListItemText
            primary={t("application:modals.expireAutomatically")}
            primaryTypographyProps={{ noWrap: true }}
            sx={{ flex: "1 1 auto", minWidth: 0 }}
          />
          <FormControl variant="standard" sx={{ flexShrink: 0 }}>
            <Autocomplete
              size="small"
              value={setting.expires ? (setting.expires_val ?? neverOption) : neverOption}
              filterOptions={(options, params) => {
                const filtered = filter(options, params);

                const { inputValue } = params;
                const value = parseInt(inputValue) * 60;
                if (inputValue !== "" && isNumeric(inputValue) && parseInt(inputValue) > 0 && value != 300) {
                  filtered.push({
                    inputValue,
                    value,
                    label: inputValue + " " + t("application:modals.minutes"),
                  });
                }

                return filtered;
              }}
              onChange={(_event, newValue) => {
                let expiry = 0;
                let label = "";
                if (typeof newValue === "string") {
                  expiry = parseInt(newValue) * 60;
                  label = newValue + " " + t("application:modals.minutes");
                } else {
                  expiry = newValue?.value ?? 0;
                  label = newValue?.label ?? "";
                }

                onSettingChange({
                  ...setting,
                  expires: expiry > 0,
                  ...(expiry > 0 ? { expires_val: { value: expiry, label } } : {}),
                });
              }}
              freeSolo
              getOptionLabel={(option: string | valueOption) => (typeof option === "string" ? option : t(option.label))}
              disableClearable
              options={[neverOption, ...expireOptions]}
              renderInput={(params) => <TextField sx={{ width: 120 }} {...params} variant={"standard"} />}
            />
          </FormControl>
        </StyledListItemButton>
      </List>
      <Divider sx={{ my: 0.5 }} />
      <List sx={{ padding: 0 }}>
        <ListItemButton onClick={() => setAdvancedToggled(!advancedOpen)}>
          <ListItemIcon>
            <SettingsOutlined />
          </ListItemIcon>
          <ListItemText
            primary={t("application:modals.additionalOptions")}
            secondary={advancedSummary || undefined}
            secondaryTypographyProps={{ noWrap: true }}
          />
          <ChevronRight
            fontSize="small"
            sx={{
              transform: advancedOpen ? "rotate(90deg)" : "none",
              transition: "transform .2s",
            }}
          />
        </ListItemButton>
        <Collapse in={advancedOpen}>
          <List sx={{ padding: 0 }}>
            <Accordion expanded={expanded === "use_custom_link"} onChange={handleExpand("use_custom_link")}>
              <AccordionSummary aria-controls="panel-slug-content" id="panel-slug-header">
                <StyledListItemButton>
                  <ListItemIcon>
                    <RenameOutlined />
                  </ListItemIcon>
                  <ListItemText primary={t("application:modals.customLink")} />
                  <ListItemSecondaryAction>
                    <Checkbox checked={!!setting.use_custom_link} onChange={handleCheck("use_custom_link")} />
                  </ListItemSecondaryAction>
                </StyledListItemButton>
              </AccordionSummary>
              <AccordionDetails sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Typography variant="body2">{t("application:modals.customLinkDes")}</Typography>
                {setting.use_custom_link && (
                  <FormControl variant="standard" fullWidth sx={{ mt: 1 }}>
                    <FilledTextField
                      label={t("application:modals.customLinkName")}
                      slotProps={{
                        input: {
                          startAdornment: <span style={{ marginRight: 4, opacity: 0.6 }}>/s/</span>,
                        },
                      }}
                      value={setting.slug ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.toLowerCase();
                        if (value !== "" && !/^[a-z0-9][a-z0-9._~-]*$/.test(value)) return;
                        onSettingChange({ ...setting, slug: value.slice(0, 64) });
                      }}
                    />
                  </FormControl>
                )}
              </AccordionDetails>
            </Accordion>
            <Accordion expanded={expanded === "note"} onChange={handleExpand("note")}>
              <AccordionSummary aria-controls="panel-note-content" id="panel-note-header">
                <StyledListItemButton>
                  <ListItemIcon>
                    <RenameOutlined />
                  </ListItemIcon>
                  <ListItemText
                    primary={t("application:modals.shareNote")}
                    secondary={setting.note || undefined}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </StyledListItemButton>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {t("application:modals.shareNoteDes")}
                </Typography>
                <FormControl variant="standard" fullWidth>
                  <FilledTextField
                    label={t("application:modals.shareNote")}
                    slotProps={{
                      htmlInput: {
                        maxLength: 255,
                      },
                    }}
                    value={setting.note ?? ""}
                    onChange={(e) => onSettingChange({ ...setting, note: e.target.value })}
                  />
                </FormControl>
              </AccordionDetails>
            </Accordion>
            <Accordion expanded={expanded === "price"} onChange={handleExpand("price")}>
              <AccordionSummary aria-controls="panel-price-content" id="panel-price-header">
                <StyledListItemButton>
                  <ListItemIcon>
                    <CoinStack />
                  </ListItemIcon>
                  <ListItemText
                    primary={t("application:modals.paidShare")}
                    secondary={
                      setting.price_points
                        ? t("application:modals.paidSharePrice", { price: setting.price_points })
                        : undefined
                    }
                  />
                </StyledListItemButton>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {t("application:modals.paidShareDes")}
                </Typography>
                <FormControl variant="standard" fullWidth>
                  <FilledTextField
                    label={t("application:modals.paidSharePriceLabel")}
                    type="number"
                    slotProps={{
                      htmlInput: {
                        min: 0,
                      },
                    }}
                    value={setting.price_points ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      onSettingChange({ ...setting, price_points: v > 0 ? v : undefined });
                    }}
                  />
                </FormControl>
              </AccordionDetails>
            </Accordion>
            <Accordion expanded={expanded === "listed_publicly"} onChange={handleExpand("listed_publicly")}>
              <AccordionSummary aria-controls="panel-listed-content" id="panel-listed-header">
                <StyledListItemButton>
                  <ListItemIcon>
                    <Globe />
                  </ListItemIcon>
                  <ListItemText primary={t("application:modals.publicListing")} />
                  <ListItemSecondaryAction>
                    <Checkbox
                      checked={!!setting.listed_publicly}
                      disabled={!!setting.is_private}
                      onChange={handleCheck("listed_publicly")}
                    />
                  </ListItemSecondaryAction>
                </StyledListItemButton>
              </AccordionSummary>
              <AccordionDetails>{t("application:modals.publicListingDes")}</AccordionDetails>
            </Accordion>
            {isFile && (
              <StyledListItemButton disableRipple sx={{ cursor: "default", gap: 1 }}>
                <ListItemIcon>
                  <ClockArrowDownload />
                </ListItemIcon>
                <ListItemText
                  primary={t("application:modals.expireAfterDownload")}
                  primaryTypographyProps={{ noWrap: true }}
                  sx={{ flex: "1 1 auto", minWidth: 0 }}
                />
                <FormControl variant="standard" sx={{ flexShrink: 0 }}>
                  <Autocomplete
                    size="small"
                    value={setting.downloads ? (setting.downloads_val ?? neverOption) : neverOption}
                    filterOptions={(options, params) => {
                      const filtered = filter(options, params);

                      const { inputValue } = params;
                      const value = parseInt(inputValue);
                      if (
                        inputValue !== "" &&
                        isNumeric(inputValue) &&
                        parseInt(inputValue) > 0 &&
                        !filtered.find((v) => v.value == value)
                      ) {
                        filtered.push({
                          inputValue,
                          value,
                          label: inputValue,
                        });
                      }

                      return filtered;
                    }}
                    onChange={(_event, newValue) => {
                      let downloads = 0;
                      let label = "";
                      if (typeof newValue === "string") {
                        downloads = parseInt(newValue);
                        label = newValue;
                      } else {
                        downloads = newValue?.value ?? 0;
                        label = newValue?.label ?? "";
                      }

                      onSettingChange({
                        ...setting,
                        downloads: downloads > 0,
                        ...(downloads > 0 ? { downloads_val: { value: downloads, label } } : {}),
                      });
                    }}
                    freeSolo
                    getOptionLabel={(option: string | valueOption) =>
                      typeof option === "string"
                        ? option
                        : option.value === 0
                          ? t(option.label)
                          : t("application:modals.downloadLimitOptions", {
                              num: option.label,
                            })
                    }
                    disableClearable
                    options={[neverOption, ...downloadOptions]}
                    renderInput={(params) => <TextField sx={{ width: 120 }} {...params} variant={"standard"} />}
                  />
                </FormControl>
              </StyledListItemButton>
            )}
            {isFolder && (
              <>
                <Accordion expanded={expanded === "share_view"} onChange={handleExpand("share_view")}>
                  <AccordionSummary aria-controls="panel1a-content" id="panel1a-header">
                    <StyledListItemButton>
                      <ListItemIcon>
                        <TableSettingsOutlined />
                      </ListItemIcon>
                      <ListItemText primary={t("application:modals.shareView")} />
                      <ListItemSecondaryAction>
                        <Checkbox checked={setting.share_view} onChange={handleCheck("share_view")} />
                      </ListItemSecondaryAction>
                    </StyledListItemButton>
                  </AccordionSummary>
                  <AccordionDetails>{t("application:modals.shareViewDes")}</AccordionDetails>
                </Accordion>
                <Accordion expanded={expanded === "show_readme"} onChange={handleExpand("show_readme")}>
                  <AccordionSummary aria-controls="panel1a-content" id="panel1a-header">
                    <StyledListItemButton>
                      <ListItemIcon>
                        <BookInformation />
                      </ListItemIcon>
                      <ListItemText primary={t("application:modals.showReadme")} />
                      <ListItemSecondaryAction>
                        <Checkbox checked={setting.show_readme} onChange={handleCheck("show_readme")} />
                      </ListItemSecondaryAction>
                    </StyledListItemButton>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Trans i18nKey="application:modals.showReadmeDes" components={[<Code key="0" />]} />
                    <StyledListItemButton disabled={!setting.show_readme}>
                      <ListItemText
                        primary={t("application:modals.hideReadme")}
                        secondary={t("application:modals.hideReadmeDes")}
                      />
                      <ListItemSecondaryAction>
                        <Checkbox
                          checked={setting.show_readme && setting.hide_readme}
                          disabled={!setting.show_readme}
                          onChange={() => onSettingChange({ ...setting, hide_readme: !setting.hide_readme })}
                        />
                      </ListItemSecondaryAction>
                    </StyledListItemButton>
                  </AccordionDetails>
                </Accordion>
              </>
            )}
          </List>
        </Collapse>
      </List>
    </>
  );
};

export default ShareSettingContent;
