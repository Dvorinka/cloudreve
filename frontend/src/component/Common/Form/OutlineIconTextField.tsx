import { InputAdornment, TextField, TextFieldProps, useMediaQuery, useTheme } from "@mui/material";
import { forwardRef } from "react";

export interface OutlineIconTextFieldProps extends TextFieldProps<"outlined"> {
  icon: React.ReactNode;
}

export const OutlineIconTextField = forwardRef<HTMLDivElement, OutlineIconTextFieldProps>(
  ({ icon, ...rest }, ref) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
    return (
      <TextField
        ref={ref}
        {...rest}
        slotProps={{
          input: {
            startAdornment: !isMobile && <InputAdornment position="start">{icon}</InputAdornment>,
            ...rest.InputProps,
          },
        }}
      />
    );
  },
);
OutlineIconTextField.displayName = "OutlineIconTextField";
