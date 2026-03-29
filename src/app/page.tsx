"use client";

import { useState } from "react";
import DropZone from "./components/DropZone";
import ReportsList from "./components/ReportsList";

export default function HomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [showDrop, setShowDrop] = useState(true);

  const handleFilesPicked = (picked: File[]) => {
    setFiles(picked);
    setShowDrop(false);
  };

  const resetFiles = () => {
    setFiles([]);
    setShowDrop(true);
  };

  return (
    <div className="h-full w-full py-3">
      {showDrop ? (
        <DropZone onFilesPicked={handleFilesPicked} />
      ) : (
        <>
          <button
            onClick={resetFiles}
            className="mb-6 rounded-2xl bg-slate-900 px-5 py-3 text-white"
          >
            Загрузить новый файл
          </button>
          <ReportsList files={files} />
        </>
      )}
    </div>
  );
}
