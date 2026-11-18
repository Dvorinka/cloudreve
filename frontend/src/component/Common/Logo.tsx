import { Box, BoxProps, Skeleton, useTheme } from "@mui/material";
import React, { useEffect, useRef } from "react";
import { useAppSelector } from "../../redux/hooks.ts";

const Logo = (props: BoxProps) => {
  const theme = useTheme();
  const imageRef = useRef<HTMLImageElement>();
  const [loaded, setLoaded] = React.useState(false);
  const { mode } = theme.palette;
  const logo = useAppSelector((state) => state.siteConfig.basic.config.logo);
  const logo_light = useAppSelector((state) => state.siteConfig.basic.config.logo_light);
  useEffect(() => {
    setLoaded(logo == logo_light);
  }, [mode]);

  useEffect(() => {
    if (imageRef.current?.complete) {
      setLoaded(true);
    }
  }, []);

  return (
    <>
      {(!logo || !loaded) && <Skeleton animation="wave" variant="rectangular" sx={props.sx} />}
      {logo && (
        <Box
          ref={imageRef}
          component={"img"}
          onLoad={() => setLoaded(true)}
          src={mode === "light" ? logo : logo_light}
          alt="Logo"
          {...props}
          sx={{
            display: loaded ? "block" : "none",
            // disable drag
            userSelect: "none",
            WebkitUserDrag: "none",
            MozUserDrag: "none",
            msUserDrag: "none",
            ...(props.sx as object),
          }}
        />
      )}
    </>
  );
};

export default Logo;
