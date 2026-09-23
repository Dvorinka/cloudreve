import { alpha, Box, Button, Grid, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "../../../redux/hooks.ts";
import ArrowDown from "../../Icons/ArrowDown.tsx";

const DesktopAppPromotion = () => {
  const title = useAppSelector((state) => state.siteConfig.basic.config.title);
  const { t } = useTranslation();
  const theme = useTheme();
  const isMd = useMediaQuery(theme.breakpoints.up("md"), {
    defaultMatches: true,
  });

  return (
    <Grid
      container
      sx={{
        px: 2,
        pt: 4,
        pb: 4,
      }}
    >
      <Grid item container alignItems={"center"} xs={12} md={6}>
        <Box data-aos={isMd ? "fade-right" : "fade-up"}>
          <Box marginBottom={2}>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 700,
              }}
              color="text.primary"
            >
              {t("setting.desktopAppTitleLead")}
              <Typography
                color={"primary"}
                component={"span"}
                variant={"inherit"}
                sx={{
                  background: `linear-gradient(180deg, transparent 82%, ${alpha(
                    theme.palette.secondary.main,
                    0.3,
                  )} 0%)`,
                }}
              >
                {title}
              </Typography>
              {t("setting.desktopAppTitleTrail")}
            </Typography>
          </Box>
          <Box marginBottom={3}>
            <Typography variant="h6" component="p" color="text.secondary">
              {t("setting.desktopAppDescription")}
            </Typography>
          </Box>
          <Box
            display="flex"
            flexDirection={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            gap={2}
            marginTop={1}
          >
            <Button
              variant="contained"
              size="large"
              href="https://github.com/Dvorinka/cloudreve/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<ArrowDown />}
            >
              {t("setting.downloadDesktopApp")}
            </Button>
          </Box>
        </Box>
      </Grid>
      <Grid
        item
        container
        alignItems={"center"}
        justifyContent={"center"}
        xs={12}
        md={6}
        data-aos="fade-up"
        data-aos-delay="100"
      >
        <Box
          component={"img"}
          src={"/static/img/cloudreve.svg"}
          alt="Cloudreve Desktop"
          sx={{
            width: { xs: "60%", md: "70%" },
            maxWidth: 360,
            filter: theme.palette.mode === "dark" ? "brightness(0.9)" : "none",
          }}
        />
      </Grid>
    </Grid>
  );
};

export default DesktopAppPromotion;
