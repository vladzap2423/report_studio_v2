export type CryptoProCertificate = {
  thumbprint: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
};

export type CryptoProDiagnostics = {
  origin: string;
  jsModuleVersion: string | null;
  hasGlobal: boolean;
  hasThen: boolean;
  hasCreateObjectAsync: boolean;
  hasCreateObject: boolean;
  hasSetLogLevel: boolean;
  hasSet: boolean;
  hasAsyncSpawn: boolean;
  objectType: string;
  constructorName: string | null;
  objectTag: string;
  ownKeys: string[];
  loaderScriptSources: string[];
  userAgent: string;
};

const CADES_PLUGIN_SCRIPT_URLS = [
  "/vendor/cryptopro/cadesplugin_api.js",
  "https://cryptopro.ru/sites/default/files/products/cades/cadesplugin_api.js",
] as const;

let cadesPluginPromise: Promise<any> | null = null;

function hasUsableCryptoProApi(plugin: any) {
  return Boolean(
    plugin &&
      (typeof plugin.then === "function" ||
        typeof plugin.CreateObjectAsync === "function" ||
        typeof plugin.CreateObject === "function" ||
        typeof plugin.set_log_level === "function" ||
        typeof plugin.JSModuleVersion !== "undefined")
  );
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type CallbackHandle = {
  restore: () => void;
};

function attachPluginCallbacks(
  onLoaded: () => void,
  onTimeout: () => void
): CallbackHandle {
  const previousLoaded = (window as any).cadesplugin_plugin_loaded_callback;
  const previousTimeout = (window as any).cadesplugin_timeout_failed_callback;

  (window as any).cadesplugin_plugin_loaded_callback = () => {
    try {
      if (typeof previousLoaded === "function") {
        previousLoaded();
      }
    } finally {
      onLoaded();
    }
  };

  (window as any).cadesplugin_timeout_failed_callback = () => {
    try {
      if (typeof previousTimeout === "function") {
        previousTimeout();
      }
    } finally {
      onTimeout();
    }
  };

  return {
    restore: () => {
      (window as any).cadesplugin_plugin_loaded_callback = previousLoaded;
      (window as any).cadesplugin_timeout_failed_callback = previousTimeout;
    },
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function toIsoString(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

async function waitForPluginReady(initialPlugin?: any) {
  let plugin = initialPlugin ?? window.cadesplugin;

  if (plugin && typeof plugin.then === "function") {
    try {
      await plugin;
      const globalPlugin = window.cadesplugin;
      if (globalPlugin && typeof globalPlugin.CreateObjectAsync === "function") {
        return globalPlugin;
      }
    } catch {
      // Ниже вернём более понятную ошибку после повторной проверки глобального объекта.
    }
  }

  plugin = window.cadesplugin ?? plugin;
  if (plugin && typeof plugin.CreateObjectAsync === "function") {
    return plugin;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(100);
    plugin = window.cadesplugin ?? plugin;

    if (plugin && typeof plugin.then === "function") {
      try {
        await plugin;
        const globalPlugin = window.cadesplugin;
        if (globalPlugin && typeof globalPlugin.CreateObjectAsync === "function") {
          return globalPlugin;
        }
      } catch {
        // Ошибка будет поднята ниже.
      }
    }

    if (plugin && typeof plugin.CreateObjectAsync === "function") {
      return plugin;
    }
  }

  throw new Error(
    "CryptoPro Browser plug-in загружен, но API CreateObjectAsync не инициализировался. Обычно это означает, что cadesplugin_api.js загрузился не полностью или несовместим с текущим расширением."
  );
}

export async function loadCryptoProPlugin() {
  if (typeof window === "undefined") {
    throw new Error("CryptoPro доступен только в браузере");
  }

  if (!cadesPluginPromise) {
    cadesPluginPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        callbackHandle.restore();
        resolve();
      };
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        callbackHandle.restore();
        reject(error);
      };

      const callbackHandle = attachPluginCallbacks(
        () => {
          void waitForPluginReady(window.cadesplugin).then(() => finishResolve()).catch(finishReject);
        },
        () => {
          finishReject(
            new Error(
              `CryptoPro Browser plug-in не инициализировался для ${window.location.origin}. Проверьте доверенные сайты, расширение и актуальность cadesplugin_api.js.`
            )
          );
        }
      );

      const existing = document.querySelector<HTMLScriptElement>('script[data-cadesplugin-loader="1"]');
      if (existing) {
        if (hasUsableCryptoProApi(window.cadesplugin)) {
          void waitForPluginReady(window.cadesplugin).then(() => finishResolve()).catch(finishReject);
          return;
        }
        existing.remove();
      }

      let urlIndex = 0;
      const tryLoadNextScript = () => {
        if (urlIndex >= CADES_PLUGIN_SCRIPT_URLS.length) {
          finishReject(
            new Error(
              "Не удалось загрузить cadesplugin_api.js. Положите актуальный файл из официальных загрузок CryptoPro в public/vendor/cryptopro/cadesplugin_api.js или откройте приложению доступ к cryptopro.ru."
            )
          );
          return;
        }

        const script = document.createElement("script");
        script.src = CADES_PLUGIN_SCRIPT_URLS[urlIndex];
        script.async = true;
        script.dataset.cadespluginLoader = "1";
        script.onload = async () => {
          try {
            const plugin = window.cadesplugin;
            if (plugin && typeof plugin.CreateObjectAsync === "function") {
              if (
                typeof plugin.set_log_level === "function" &&
                typeof plugin.LOG_LEVEL_ERROR !== "undefined"
              ) {
                plugin.set_log_level(plugin.LOG_LEVEL_ERROR);
              }
              finishResolve();
            }
          } catch (error: any) {
            finishReject(
              new Error(
                error?.message ||
                  `CryptoPro Browser plug-in не инициализировался для ${window.location.origin}. Проверьте доверенные сайты и актуальность cadesplugin_api.js.`
              )
            );
          }
        };
        script.onerror = () => {
          script.remove();
          urlIndex += 1;
          tryLoadNextScript();
        };
        document.head.appendChild(script);
      };

      tryLoadNextScript();
    });
  }

  await cadesPluginPromise;

  const plugin = window.cadesplugin;
  if (!plugin || typeof plugin.CreateObjectAsync !== "function") {
    throw new Error(
      `CryptoPro Browser plug-in не инициализировался корректно после загрузки API. Диагностика: ${describeCryptoProState(plugin)}`
    );
  }
  if (typeof plugin.set_log_level === "function" && typeof plugin.LOG_LEVEL_ERROR !== "undefined") {
    plugin.set_log_level(plugin.LOG_LEVEL_ERROR);
  }
  return plugin;
}

function collectCryptoProState(cadesplugin: any): CryptoProDiagnostics {
  const globalPlugin = typeof window !== "undefined" ? (window as any).cadesplugin : undefined;
  const target = cadesplugin ?? globalPlugin;

  return {
    origin: typeof window !== "undefined" ? window.location.origin : "",
    jsModuleVersion: target?.JSModuleVersion ?? null,
    hasGlobal: Boolean(globalPlugin),
    hasThen: typeof target?.then === "function",
    hasCreateObjectAsync: typeof target?.CreateObjectAsync === "function",
    hasCreateObject: typeof target?.CreateObject === "function",
    hasSetLogLevel: typeof target?.set_log_level === "function",
    hasSet: typeof target?.set === "function",
    hasAsyncSpawn: typeof target?.async_spawn === "function",
    objectType: typeof target,
    constructorName:
      target && typeof target === "object" && target.constructor ? String(target.constructor.name || "") : null,
    objectTag: Object.prototype.toString.call(target),
    ownKeys:
      target && (typeof target === "object" || typeof target === "function")
        ? Object.keys(target).slice(0, 50)
        : [],
    loaderScriptSources:
      typeof document !== "undefined"
        ? Array.from(
            document.querySelectorAll<HTMLScriptElement>('script[data-cadesplugin-loader="1"]')
          ).map((script) => script.src)
        : [],
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}

function describeCryptoProState(cadesplugin: any) {
  return JSON.stringify(collectCryptoProState(cadesplugin));
}

async function getStoreCertificates(cadesplugin: any) {
  const plugin = cadesplugin ?? (typeof window !== "undefined" ? (window as any).cadesplugin : undefined);

  if (!plugin || typeof plugin.CreateObjectAsync !== "function") {
    const details = describeCryptoProState(plugin);
    const npapiHint =
      plugin && typeof plugin.CreateObject === "function"
        ? " Обнаружен только CreateObject: cadesplugin_api.js ушёл в устаревшую NPAPI-ветку вместо NativeMessage."
        : "";

    throw new Error(
      `CryptoPro API инициализирован некорректно: метод CreateObjectAsync недоступен.${npapiHint} Диагностика: ${details}`
    );
  }

  try {
    const store = await plugin.CreateObjectAsync("CAdESCOM.Store");
    await store.Open(
      plugin.CAPICOM_CURRENT_USER_STORE,
      plugin.CAPICOM_MY_STORE,
      plugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED
    );

    const certificates = await store.Certificates;
    return { store, certificates };
  } catch (error: any) {
    const message = error?.message || String(error || "");
    throw new Error(
      `Не удалось открыть хранилище сертификатов CryptoPro. ${message || "Неизвестная ошибка."} Диагностика: ${describeCryptoProState(plugin)}`
    );
  }
}

export async function listCryptoProCertificates(): Promise<CryptoProCertificate[]> {
  const cadesplugin = await loadCryptoProPlugin();
  const { store, certificates } = await getStoreCertificates(cadesplugin);

  try {
    const count = Number(await certificates.Count);
    const result: CryptoProCertificate[] = [];

    for (let index = 1; index <= count; index += 1) {
      const certificate = await certificates.Item(index);
      const thumbprint = String(await certificate.Thumbprint).trim();
      const subject = String(await certificate.SubjectName).trim();
      if (!thumbprint || !subject) continue;

      result.push({
        thumbprint,
        subject,
        issuer: String(await certificate.IssuerName).trim(),
        serialNumber: String(await certificate.SerialNumber).trim(),
        validFrom: toIsoString(await certificate.ValidFromDate),
        validTo: toIsoString(await certificate.ValidToDate),
      });
    }

    return result;
  } finally {
    await store.Close();
  }
}

export async function getCryptoProDiagnostics(): Promise<CryptoProDiagnostics> {
  if (typeof window === "undefined") {
    throw new Error("CryptoPro доступен только в браузере");
  }

  try {
    const plugin = await loadCryptoProPlugin();
    return collectCryptoProState(plugin);
  } catch {
    return collectCryptoProState((window as any).cadesplugin);
  }
}

async function signBase64ContentWithCryptoPro(contentBase64: string, thumbprint: string) {
  const plugin =
    (await loadCryptoProPlugin().catch(() => undefined)) ??
    (typeof window !== "undefined" ? (window as any).cadesplugin : undefined);
  const { store, certificates } = await getStoreCertificates(plugin);

  try {
    const count = Number(await certificates.Count);
    let targetCertificate: any = null;

    for (let index = 1; index <= count; index += 1) {
      const certificate = await certificates.Item(index);
      const currentThumbprint = String(await certificate.Thumbprint).trim();
      if (currentThumbprint === thumbprint) {
        targetCertificate = certificate;
        break;
      }
    }

    if (!targetCertificate) {
      throw new Error("Выбранный сертификат не найден в хранилище");
    }

    if (!plugin || typeof plugin.CreateObjectAsync !== "function") {
      throw new Error(
        `CryptoPro API недоступен на этапе создания подписи. Диагностика: ${describeCryptoProState(plugin)}`
      );
    }

    const signer = await plugin.CreateObjectAsync("CAdESCOM.CPSigner");
    await signer.propset_Certificate(targetCertificate);
    if (typeof signer.propset_CheckCertificate === "function") {
      await signer.propset_CheckCertificate(true);
    }

    const signedData = await plugin.CreateObjectAsync("CAdESCOM.CadesSignedData");
    await signedData.propset_ContentEncoding(plugin.CADESCOM_BASE64_TO_BINARY);
    await signedData.propset_Content(contentBase64);

    const signature = await signedData.SignCades(
      signer,
      plugin.CADESCOM_CADES_BES,
      true
    );

    return {
      signature: String(signature).trim(),
      certificate: {
        thumbprint: String(await targetCertificate.Thumbprint).trim(),
        subject: String(await targetCertificate.SubjectName).trim(),
        issuer: String(await targetCertificate.IssuerName).trim(),
        serialNumber: String(await targetCertificate.SerialNumber).trim(),
        validFrom: toIsoString(await targetCertificate.ValidFromDate),
        validTo: toIsoString(await targetCertificate.ValidToDate),
      } satisfies CryptoProCertificate,
    };
  } catch (error: any) {
    const message = error?.message || String(error || "");
    throw new Error(message || "CryptoPro не смог создать подпись");
  } finally {
    await store.Close();
  }
}

export async function signBase64WithCryptoPro(contentBase64: string, thumbprint: string) {
  const normalized = String(contentBase64 || "").replace(/\s+/g, "").trim();
  if (!normalized) {
    throw new Error("Нет данных для подписи");
  }

  return signBase64ContentWithCryptoPro(normalized, thumbprint);
}

export async function signPdfWithCryptoPro(pdfBuffer: ArrayBuffer, thumbprint: string) {
  return signBase64ContentWithCryptoPro(arrayBufferToBase64(pdfBuffer), thumbprint);
}
