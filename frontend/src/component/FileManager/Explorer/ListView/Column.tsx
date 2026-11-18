import { Box, Fade, IconButton, styled } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoWrapTypography } from "../../../Common/StyledComponents.tsx";
import ArrowSortDownFilled from "../../../Icons/ArrowSortDownFilled.tsx";
import Divider from "../../../Icons/Divider.tsx";
import { ResizeProps } from "./ListHeader.tsx";
import type { ListViewColumn } from "./columnType.ts";

export { ColumType, ColumnTypeDefaults, getColumnTypeDefaults } from "./columnType.ts";
export type { ColumTypeDefaults, ColumTypeProps, ListViewColumn, ListViewColumnSetting } from "./columnType.ts";

export interface ColumnProps {
  index: number;
  column: ListViewColumn;
  showDivider?: boolean;
  startResizing: (props: ResizeProps) => void;
  sortable?: boolean;
  sortDirection?: string;
  setSortBy?: (order_by: string, order_direction: string) => void;
}

const ColumnContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== "w",
})<{
  w: number;
}>(({ w }) => ({
  height: "39px",
  width: `${w}px`,
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
}));

const DividerContainer = styled(Box)(({ theme }) => ({
  color: theme.palette.divider,
  maxWidth: "10px",
  display: "flex",
  alignItems: "center",
  cursor: "col-resize",
  "&:hover": {
    color: theme.palette.primary.main,
  },
  transition: theme.transitions.create(["color"], {
    duration: theme.transitions.duration.shortest,
  }),
  position: "relative",
  right: "-8px",
}));

const SortArrow = styled(ArrowSortDownFilled, {
  shouldForwardProp: (prop) => prop !== "direction",
})<{
  direction?: string;
}>(({ theme, direction }) => ({
  width: "18px",
  height: "18px",
  color: !direction ? theme.palette.action.disabled : theme.palette.action.active,
  transform: `rotate(${direction === "asc" ? 180 : 0}deg)`,
  transition: theme.transitions.create(["color", "transform"], {
    duration: theme.transitions.duration.shortest,
  }),
}));

const Column = ({ column, showDivider, index, startResizing, sortDirection, setSortBy, sortable }: ColumnProps) => {
  const [showSortButton, setShowSortButton] = useState(false);
  const { t } = useTranslation();
  const onSortOptionChange = useCallback(() => {
    if (!sortable || !column.defaults.order_by) return;
    const newDirection = sortDirection === "asc" ? "desc" : "asc";
    setSortBy && setSortBy(column.defaults.order_by, newDirection);
  }, [setSortBy, sortDirection, sortable, column]);

  return (
    <ColumnContainer w={column.width ?? column.defaults.width}>
      <Box
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          cursor: sortable ? "pointer" : "default",
        }}
        onMouseEnter={() => setShowSortButton(!!sortable)}
        onMouseLeave={() => setShowSortButton(false)}
        onClick={sortable ? onSortOptionChange : undefined}
      >
        <NoWrapTypography variant={"body2"} fontWeight={600}>
          {t(column.defaults.title, {
            metadata: column.props?.metadata_key,
          })}
        </NoWrapTypography>
        {sortable && (
          <Fade in={showSortButton || !!sortDirection}>
            <IconButton sx={{ ml: 1 }} size={"small"}>
              <SortArrow direction={sortDirection} />
            </IconButton>
          </Fade>
        )}
      </Box>
      <Fade in={showDivider}>
        <DividerContainer
          onMouseDown={(e) =>
            startResizing({
              index,
              startX: e.clientX,
            })
          }
        >
          <Divider />
        </DividerContainer>
      </Fade>
    </ColumnContainer>
  );
};

export default Column;
