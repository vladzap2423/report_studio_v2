"use client";

import ReportUploadForm from "./ReportUploadForm";

export default function ReportUploadPanel() {
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center">
        <ReportUploadForm />
      </div>
    </div>
  );
}
