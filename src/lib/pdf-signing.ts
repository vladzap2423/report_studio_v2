import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptPath = path.join(process.cwd(), "scripts", "pdf_signing.py");

type PreparePdfSignatureInput = {
  inputPath: string;
  preparedOutputPath: string;
  workDir: string;
  fieldName: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  columnCount: 1 | 2;
  stepOrder: number;
  stepTotal: number;
  signerName: string;
  certificateSubject?: string;
  certificateThumbprint?: string;
  certificateValidFrom?: string;
  certificateValidTo?: string;
};

type PreparePdfSignatureResult = {
  preparedPdfPath: string;
  bytesToSignBase64: string;
  documentDigest: string;
  reservedRegionStart: number;
  reservedRegionEnd: number;
};

type ApplyPdfSignatureInput = {
  preparedInputPath: string;
  outputPath: string;
  documentDigest: string;
  reservedRegionStart: number;
  reservedRegionEnd: number;
  signatureBase64: string;
};

async function getPythonCommand() {
  const win = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
  const nix = path.join(process.cwd(), ".venv", "bin", "python");

  try {
    await fs.access(win);
    return win;
  } catch {}

  try {
    await fs.access(nix);
    return nix;
  } catch {}

  return "python";
}

async function runPdfSigningScript(args: string[]) {
  const pythonPath = await getPythonCommand();
  await fs.access(scriptPath);
  return execFileAsync(pythonPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function preparePdfSignature(
  input: PreparePdfSignatureInput
): Promise<PreparePdfSignatureResult> {
  await fs.mkdir(input.workDir, { recursive: true });

  const toSignPath = path.join(input.workDir, `${input.fieldName}.bin`);
  const metaPath = path.join(input.workDir, `${input.fieldName}.json`);

  try {
    await runPdfSigningScript([
      "prepare",
      "--input",
      input.inputPath,
      "--prepared-output",
      input.preparedOutputPath,
      "--to-sign-output",
      toSignPath,
      "--meta-output",
      metaPath,
      "--field-name",
      input.fieldName,
      "--x-ratio",
      String(input.xRatio),
      "--y-ratio",
      String(input.yRatio),
      "--width-ratio",
      String(input.widthRatio),
      "--height-ratio",
      String(input.heightRatio),
      "--column-count",
      String(input.columnCount),
      "--step-order",
      String(input.stepOrder),
      "--step-total",
      String(input.stepTotal),
      "--signer-name",
      input.signerName,
      "--certificate-subject",
      input.certificateSubject || "",
      "--certificate-thumbprint",
      input.certificateThumbprint || "",
      "--certificate-valid-from",
      input.certificateValidFrom || "",
      "--certificate-valid-to",
      input.certificateValidTo || "",
    ]);

    const [metaRaw, toSignBuffer] = await Promise.all([
      fs.readFile(metaPath, "utf8"),
      fs.readFile(toSignPath),
    ]);
    const meta = JSON.parse(metaRaw) as {
      prepared_pdf_path: string;
      document_digest: string;
      reserved_region_start: number;
      reserved_region_end: number;
    };

    return {
      preparedPdfPath: meta.prepared_pdf_path,
      bytesToSignBase64: toSignBuffer.toString("base64"),
      documentDigest: meta.document_digest,
      reservedRegionStart: Number(meta.reserved_region_start),
      reservedRegionEnd: Number(meta.reserved_region_end),
    };
  } finally {
    await Promise.all([
      fs.rm(toSignPath, { force: true }).catch(() => null),
      fs.rm(metaPath, { force: true }).catch(() => null),
    ]);
  }
}

export async function applyPdfSignature(input: ApplyPdfSignatureInput) {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const signatureBase64Path = path.join(
    path.dirname(input.outputPath),
    `${path.basename(input.outputPath)}.sig.b64`
  );

  try {
    await fs.writeFile(signatureBase64Path, input.signatureBase64, "utf8");

    await runPdfSigningScript([
      "apply",
      "--prepared-input",
      input.preparedInputPath,
      "--output",
      input.outputPath,
      "--document-digest",
      input.documentDigest,
      "--reserved-region-start",
      String(input.reservedRegionStart),
      "--reserved-region-end",
      String(input.reservedRegionEnd),
      "--signature-base64-file",
      signatureBase64Path,
    ]);

    const stat = await fs.stat(input.outputPath);
    return {
      outputPath: input.outputPath,
      outputSize: stat.size,
    };
  } finally {
    await fs.rm(signatureBase64Path, { force: true }).catch(() => null);
  }
}
