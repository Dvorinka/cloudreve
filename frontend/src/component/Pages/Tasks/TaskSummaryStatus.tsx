import { Box, styled, Tooltip, Typography, useTheme } from "@mui/material";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { TaskStatus, TaskSummary, TaskType } from "../../../api/workflow.ts";
import { useAppDispatch } from "../../../redux/hooks.ts";
import { sizeToString } from "../../../util";
import ArrowSyncCircleFilled from "../../Icons/ArrowSyncCircleFilled.tsx";
import CheckCircleFilled from "../../Icons/CheckCircleFilled.tsx";
import CircleHintFilled from "../../Icons/CircleHintFilled.tsx";
import DismissCircleFilled from "../../Icons/DismissCircleFilled.tsx";

const ArrowSyncCircleFilledSpin = styled(ArrowSyncCircleFilled)({
  animation: "spin 4s linear infinite",
  "@keyframes spin": {
    from: {
      transform: "rotate(0deg)",
    },
    to: {
      transform: "rotate(360deg)",
    },
  },
});

export interface TaskSummaryStatusProps {
  type: string;
  status: string;
  summary?: TaskSummary;
  error?: string;
  simplified?: boolean;
  // Live transfer-phase progress percent for remote downloads.
  transferPercent?: number;
}

interface TaskStatusContentProps {
  color: string;
  icon: React.ReactNode;
  label: string;
  [key: string]: any;
}
const TaskStatusContent = forwardRef(({ icon, label, color, ...props }: TaskStatusContentProps, ref) => {
  return (
    <Box ref={ref} {...props}>
      <Typography variant={"body2"} component={"div"} sx={{ color, display: "flex", mx: 0.5 }} noWrap>
        <Box sx={{ mr: 0.5, pt: "6px" }}>{icon}</Box>
        <Box sx={{ mt: "6px" }}>{label}</Box>
      </Typography>
    </Box>
  );
});

const TaskSummaryStatus = ({ type, status, summary, error, simplified, transferPercent }: TaskSummaryStatusProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();

  switch (status) {
    case TaskStatus.completed:
      return (
        <TaskStatusContent
          label={t("setting.finished")}
          icon={<CheckCircleFilled fontSize={"small"} />}
          color={theme.palette.success.main}
        />
      );
    case TaskStatus.error:
      return (
        <Tooltip title={error}>
          <TaskStatusContent
            label={t("setting.failed")}
            icon={<DismissCircleFilled fontSize={"small"} />}
            color={theme.palette.error.main}
          />
        </Tooltip>
      );
    case TaskStatus.processing:
    case TaskStatus.suspending:
      if (type == TaskType.remote_download) {
        if (summary?.phase == "monitor" && summary?.props.download) {
          const downloadStatus = summary.props.download;
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                // no wrap
                whiteSpace: "nowrap",
              }}
            >
              {!simplified &&
                `${sizeToString(downloadStatus.download_speed)}/s - ${sizeToString(
                  downloadStatus.downloaded,
                )} / ${sizeToString(downloadStatus.total)}`}
              <TaskStatusContent
                label={
                  downloadStatus.total <= 0
                    ? t("download.unknownSize")
                    : `${((downloadStatus.downloaded * 100) / downloadStatus.total).toFixed(2)}%`
                }
                icon={<ArrowSyncCircleFilledSpin fontSize={"small"} />}
                color={theme.palette.primary.main}
              />
            </Box>
          );
        } else if (summary?.phase == "seeding") {
          return (
            <TaskStatusContent
              label={t("setting.seeding")}
              icon={<ArrowSyncCircleFilledSpin fontSize={"small"} />}
              color={theme.palette.primary.main}
            />
          );
        } else if (summary?.phase == "transfer") {
          return (
            <TaskStatusContent
              label={
                transferPercent != undefined
                  ? `${t("download.transferring")} ${transferPercent.toFixed(0)}%`
                  : t("download.transferring")
              }
              icon={<ArrowSyncCircleFilledSpin fontSize={"small"} />}
              color={theme.palette.primary.main}
            />
          );
        } else {
          return (
            <TaskStatusContent
              label={t("setting.processing")}
              icon={<ArrowSyncCircleFilledSpin fontSize={"small"} />}
              color={theme.palette.primary.main}
            />
          );
        }
      }
      return (
        <TaskStatusContent
          label={t("setting.processing")}
          icon={<ArrowSyncCircleFilledSpin fontSize={"small"} />}
          color={theme.palette.primary.main}
        />
      );
    case TaskStatus.queued:
      return (
        <TaskStatusContent
          label={t("application:setting.queueing")}
          icon={<CircleHintFilled fontSize={"small"} />}
          color={theme.palette.action.active}
        />
      );
    case TaskStatus.canceled:
      return (
        <TaskStatusContent
          label={t("setting.canceled")}
          icon={<DismissCircleFilled fontSize={"small"} />}
          color={theme.palette.action.active}
        />
      );
  }
};

export default TaskSummaryStatus;
