import { SvgIconProps, Typography } from "@mui/material";

export interface EmojiIconProps extends SvgIconProps {
  emoji: string;
}

const EmojiIcon = ({ sx, fontSize, emoji, ...rest }: EmojiIconProps) => {
  return (
    <Typography
      sx={{
        color: "text.primary",
        minWidth: "24px",
        pl: "4px",
        ...sx,
      }}
      fontSize={fontSize}
      {...(rest as object)}
    >
      {emoji}
    </Typography>
  );
};

export default EmojiIcon;
