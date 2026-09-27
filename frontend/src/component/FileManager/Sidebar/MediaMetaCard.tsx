import { Box, Link, LinkProps, ListItemIcon, ListItemText, Menu, SvgIconProps, Typography } from "@mui/material";
import SvgIcon from "@mui/material/SvgIcon/SvgIcon";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "../../../redux/hooks.ts";
import { searchMetadata } from "../../../redux/thunks/filemanager.ts";
import { copyToClipboard } from "../../../util";
import Clipboard from "../../Icons/Clipboard.tsx";
import Search from "../../Icons/Search.tsx";
import { SquareMenuItem } from "../ContextMenu/ContextMenu.tsx";
import { FileManagerIndex } from "../FileManager.tsx";
import { StyledButtonBase } from "./StyledButtonBase.tsx";

export interface MediaMetaElements {
  display: string;
  searchKey: string;
  searchValue: string;
}

export interface MediaMetaContent {
  title: (MediaMetaElements | string)[];
  content: (MediaMetaElements | string)[];
}

export interface MediaMetaCardProps {
  contents: MediaMetaContent[];
  icon?: typeof SvgIcon | ((props: SvgIconProps) => JSX.Element);
}

export interface MediaMetaElementsProps extends LinkProps {
  element: MediaMetaElements;
}

export const MediaMetaElements = ({ element, ...rest }: MediaMetaElementsProps) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const handleSearch = () => {
    dispatch(searchMetadata(FileManagerIndex.main, element.searchKey, element.searchValue));
    handleClose();
  };

  const handleCopy = () => {
    copyToClipboard(element.display);
    handleClose();
  };

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const handleClose = () => {
    setAnchorEl(null);
  };
  return (
    <>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        <SquareMenuItem onClick={handleSearch} dense>
          <ListItemIcon>
            <Search fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t("application:fileManager.searchSomething", {
              text: element?.display ?? "",
            })}
          </ListItemText>
        </SquareMenuItem>
        <SquareMenuItem onClick={handleCopy} dense>
          <ListItemIcon>
            <Clipboard fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("application:fileManager.copyToClipboard")}</ListItemText>
        </SquareMenuItem>
      </Menu>
      <Link color="inherit" href={"#"} onClick={(e) => setAnchorEl(e.currentTarget)} underline="hover" {...rest}>
        {element.display}
      </Link>
    </>
  );
};

const MediaMetaCard = ({ contents, icon }: MediaMetaCardProps) => {
  const Icon = icon;
  return (
    <>
      <StyledButtonBase>
        {Icon && <Icon sx={{ pt: "2px" }} color={"action"} />}
        <Box
          sx={{
            mr: Icon ? 1 : 0,
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {contents.map(({ title, content }, i) => (
            <Box key={i}>
              <Typography variant={"body2"} color="textPrimary" fontWeight={500}>
                {title.map((element, i) =>
                  typeof element === "string" ? element : <MediaMetaElements key={i} element={element} />,
                )}
              </Typography>
              <Typography variant={"body2"} color={"text.secondary"}>
                {content.map((element, i) =>
                  typeof element === "string" ? element : <MediaMetaElements key={i} element={element} />,
                )}
              </Typography>
            </Box>
          ))}
        </Box>
      </StyledButtonBase>
    </>
  );
};
export default MediaMetaCard;
