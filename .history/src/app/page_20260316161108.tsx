"use client";
import { useState } from "react";
import DropZone from "../components/DropZone";
import ScriptsList from "../components/ScriptsList";

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
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        {showDrop ? (
          <DropZone onFilesPicked={handleFilesPicked} />
        ) : (
          <>
            <button onClick={resetFiles} className="mb-6 rounded-2xl bg-slate-900 px-5 py-3 text-white">
              Загрузить новый файл
            </button>
            <ScriptsList files={files} />
          </>
        )}
      </div>
    </main>
  );
}