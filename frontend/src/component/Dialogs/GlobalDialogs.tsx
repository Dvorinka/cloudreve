import { useAppSelector } from "../../redux/hooks.ts";
import PinToSidebar from "../FileManager/Dialogs/PinToSidebar.tsx";
import ActivityDialog from "../FileManager/Dialogs/Activity/ActivityDialog.tsx";
import BatchDownloadLog from "./BatchDownloadLog.tsx";
import Confirmation from "./Confirmation.tsx";
import SelectOption from "./SelectOption.tsx";

const GlobalDialogs = () => {
  const selectOptionOpen = useAppSelector((state) => state.globalState.selectOptionDialogOpen);
  const batchDownloadLogOpen = useAppSelector((state) => state.globalState.batchDownloadLogDialogOpen);
  return (
    <>
      <Confirmation />
      <PinToSidebar />
      {/* Activity feed is global-state driven; mounted app-wide so the
          Shares page can open a share's history. */}
      <ActivityDialog />
      {batchDownloadLogOpen != undefined && <BatchDownloadLog />}
      {selectOptionOpen != undefined && <SelectOption />}
    </>
  );
};

export default GlobalDialogs;
