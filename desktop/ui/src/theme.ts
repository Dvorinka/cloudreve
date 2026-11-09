import { createTheme } from "@mui/material/styles";
import type { ThemeOptions } from "@mui/material/styles";

export const applyThemeWithOverrides = (themeConfig: ThemeOptions): ThemeOptions => {
  return {
    ...themeConfig,
    shape: {
      ...themeConfig.shape,
      borderRadius: 12,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            overscrollBehavior: "none",
            backgroundColor: themeConfig.palette?.mode === "dark" ? "#121212" : "#fafafa",
          },
          img: {
            userSelect: "none",
            pointerEvents: "none",
            "-webkit-user-drag": "none",
          },
        },
      },
      MuiTypography: {
        styleOverrides: {
          root: {
            userSelect: "none",
          },
        },
      },
      MuiTooltip: {
        defaultProps: {
          enterDelay: 500,
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
        defaultProps: {
          disableElevation: true,
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
      },
      MuiSkeleton: {
        defaultProps: {
          animation: "wave",
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: "8px",
          },
          list: {
            padding: "4px 0",
          },
        },
        defaultProps: {
          slotProps: {
            paper: {
              elevation: 3,
            },
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            paddingTop: 0,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: "8px",
            margin: "0px 4px",
            paddingLeft: "8px",
            paddingRight: "8px",
          },
        },
      },
      MuiFilledInput: {
        styleOverrides: {
          root: {
            "&::before, &::after": {
              borderBottom: "none",
            },
            "&:hover:not(.Mui-disabled, .Mui-error):before": {
              borderBottom: "none",
            },
            borderRadius: 12,
          },
        },
      },
    },
  };
};

export const createAppTheme = (mode: "light" | "dark" = "light") => {
  const isDark = mode === "dark";
  const themeConfig: ThemeOptions = {
    palette: {
      mode,
      // Explicit surfaces keep text readable in both modes instead of
      // relying on MUI's mode-derived greys, which wash out on dark.
      background: {
        default: isDark ? "#121212" : "#fafafa",
        paper: isDark ? "#1e1e1e" : "#ffffff",
      },
      text: {
        primary: isDark ? "#e8e8e8" : "#1c1c1c",
        secondary: isDark ? "#a3a3a3" : "#616161",
      },
    },
  };

  return createTheme(applyThemeWithOverrides(themeConfig));
};

export const theme = createAppTheme("light");
