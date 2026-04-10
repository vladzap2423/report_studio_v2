"use client";

import { useCallback, useEffect, useState } from "react";
import DropZone from "./components/DropZone";
import ReportsList from "./components/ReportsList";
import { REPORT_RUN_STORAGE_KEY } from "./components/report-run-storage";

export default function HomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [showDrop, setShowDrop] = useState(true);
  const [checkedStoredRun, setCheckedStoredRun] = useState(false);
  const [runBusy, setRunBusy] = useState(false);

  useEffect(() => {
    const storedRunId = window.localStorage.getItem(REPORT_RUN_STORAGE_KEY);
    if (storedRunId) {
      setShowDrop(false);
    }
    setCheckedStoredRun(true);
  }, []);

  const handleFilesPicked = useCallback((picked: File[]) => {
    setFiles(picked);
    setShowDrop(false);
  }, []);

  const resetFiles = useCallback(() => {
    setFiles([]);
    setShowDrop(true);
    setRunBusy(false);
    window.localStorage.removeItem(REPORT_RUN_STORAGE_KEY);
  }, []);

  if (!checkedStoredRun) {
    return <div className="h-full w-full py-3" />;
  }

  return (
    <div className="h-full w-full py-3">
      {showDrop ? (
        <DropZone onFilesPicked={handleFilesPicked} />
      ) : (
        <ReportsList
          files={files}
          onRequestStartOver={resetFiles}
          onRunBusyChange={setRunBusy}
          allowStartOver={!runBusy}
        />
      )}
    </div>
  );
}
