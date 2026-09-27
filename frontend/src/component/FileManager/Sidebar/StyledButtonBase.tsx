import { Box, styled } from "@mui/material";

// Extracted to a leaf module: MediaMetaCard -> FileManager -> CustomProps
// -> CustomPropsItem forms an import cycle, so StyledButtonBase lived in a
// TDZ when CustomPropsItem evaluated styled(StyledButtonBase) at module init.
export const StyledButtonBase = styled(Box)(({ theme }) => {
  let bgColor = theme.palette.mode === "light" ? theme.palette.grey[100] : theme.palette.grey[900];
  let bgColorHover = theme.palette.mode === "light" ? theme.palette.grey[300] : theme.palette.grey[700];
  return {
    borderRadius: theme.shape.borderRadius,
    backgroundColor: bgColor,
    display: "flex",
    width: "100%",
    wordBreak: "break-all",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "8px 16px",
    transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
    transitionProperty: "background-color,opacity,box-shadow",
    gap: 15,

    textAlign: "left",
    height: "100%",
    userSelect: "text",
    overflow: "hidden",
  };
});
