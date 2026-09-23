import { Box, styled } from "@mui/material";

export const RadiusFrame = styled(Box, {
  shouldForwardProp: (prop) => prop !== "withBorder" && prop !== "square",
})<{
  withBorder?: boolean;
  square?: boolean;
}>(({ theme, withBorder, square }) => ({
  borderRadius: square ? 0 : theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
  border: withBorder ? `1px solid ${theme.palette.divider}` : "initial",
}));
