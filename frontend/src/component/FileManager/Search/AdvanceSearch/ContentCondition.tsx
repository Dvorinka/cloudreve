import { useTranslation } from "react-i18next";
import { FilledTextField } from "../../../Common/StyledComponents.tsx";
import { Condition } from "./ConditionBox.tsx";

export const ContentCondition = ({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (condition: Condition) => void;
}) => {
  const { t } = useTranslation();
  return (
    <FilledTextField
      variant="filled"
      margin="dense"
      fullWidth
      autoFocus
      type="text"
      value={condition.content_query ?? ""}
      onChange={(e) => onChange({ ...condition, content_query: e.target.value })}
      helperText={t("application:navbar.fullTextSearchHelp")}
      placeholder={t("application:navbar.keywords")}
    />
  );
};
