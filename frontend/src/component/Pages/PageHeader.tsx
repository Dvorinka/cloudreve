import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import ArrowClockwiseFilled from "../Icons/ArrowClockwiseFilled.tsx";
import { useTranslation } from "react-i18next";
import PageTitle from "../../router/PageTitle.tsx";

export const PageTabQuery = "tab";

export interface PageHeaderProps {
  title: string;
  loading?: boolean;
  onRefresh?: () => void;
  skipChangingDocumentTitle?: boolean;
  secondaryAction?: React.ReactNode;
}

const PageHeader = ({ title, secondaryAction, onRefresh, loading, skipChangingDocumentTitle }: PageHeaderProps) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography
          variant={"h4"}
          fontWeight={600}
          sx={{ flexShrink: 0, maxWidth: "100%", textOverflow: "ellipsis", overflow: "hidden" }}
        >
          {title}
        </Typography>
        {!skipChangingDocumentTitle && <PageTitle title={title} />}
        {onRefresh && (
          <Tooltip title={t("application:fileManager.refresh")}>
            <IconButton onClick={onRefresh} disabled={loading} sx={{ ml: 1 }}>
              <ArrowClockwiseFilled />
            </IconButton>
          </Tooltip>
        )}
        {secondaryAction && <Box sx={{ ml: "auto" }}>{secondaryAction}</Box>}
      </Box>
    </Box>
  );
};

export default PageHeader;
