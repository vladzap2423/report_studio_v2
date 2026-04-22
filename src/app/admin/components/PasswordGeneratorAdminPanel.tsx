"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToastSync } from "@/app/components/AppToastProvider";

type CharacterGroupKey = "digits" | "letters" | "symbols";

type CharacterSets = Record<CharacterGroupKey, string>;

type MaskProfile = {
  id: string;
  name: string;
  example: string;
  mask: string;
  allowedChars: CharacterSets;
  createdAt: string;
};

const STORAGE_KEY = "gp1.passwordGenerator.maskProfiles.v2";

const KEYBOARD_GROUPS: Array<{
  key: CharacterGroupKey;
  title: string;
  maskToken: "9" | "A/a" | "!";
  chars: string;
}> = [
  { key: "digits", title: "Цифры", maskToken: "9", chars: "0123456789" },
  { key: "letters", title: "Буквы", maskToken: "A/a", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { key: "symbols", title: "Знаки", maskToken: "!", chars: "!@#$%&*+-_=?" },
];

const DEFAULT_ALLOWED_CHARS: CharacterSets = KEYBOARD_GROUPS.reduce(
  (acc, group) => ({ ...acc, [group.key]: group.chars }),
  {} as CharacterSets
);

function cloneAllowedChars(value: CharacterSets): CharacterSets {
  return {
    digits: value.digits,
    letters: value.letters,
    symbols: value.symbols,
  };
}

function uniqueId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeAllowedGroup(group: CharacterGroupKey, value: unknown) {
  const fullChars = KEYBOARD_GROUPS.find((item) => item.key === group)?.chars ?? "";
  if (typeof value !== "string") return fullChars;

  const selected = new Set(Array.from(value).map((char) => char.toLocaleUpperCase("ru-RU")));
  return Array.from(fullChars)
    .filter((char) => selected.has(char))
    .join("");
}

function normalizeAllowedChars(value: unknown): CharacterSets {
  const source = typeof value === "object" && value !== null
    ? (value as Partial<Record<CharacterGroupKey | "upper" | "lower", unknown>>)
    : null;
  const legacyLetters = typeof source?.letters === "string"
    ? source.letters
    : `${typeof source?.upper === "string" ? source.upper : ""}${typeof source?.lower === "string" ? source.lower : ""}`;

  return {
    digits: sanitizeAllowedGroup("digits", source?.digits),
    letters: sanitizeAllowedGroup("letters", legacyLetters || undefined),
    symbols: sanitizeAllowedGroup("symbols", source?.symbols),
  };
}

function normalizeProfiles(value: unknown): MaskProfile[] {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && Array.isArray((value as { profiles?: unknown }).profiles)
      ? (value as { profiles: unknown[] }).profiles
      : [];

  const result: MaskProfile[] = [];
  for (const item of rawList) {
    if (typeof item !== "object" || item === null) continue;

    const source = item as {
      id?: unknown;
      name?: unknown;
      example?: unknown;
      mask?: unknown;
      allowedChars?: unknown;
      createdAt?: unknown;
    };
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const example = typeof source.example === "string" ? source.example.trim() : "";
    const mask = typeof source.mask === "string" ? source.mask.trim() : "";

    if (!name || !mask) continue;

    result.push({
      id: typeof source.id === "string" && source.id ? source.id : uniqueId(),
      name,
      example,
      mask,
      allowedChars: normalizeAllowedChars(source.allowedChars),
      createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date().toISOString(),
    });
  }

  return result;
}

function isLetter(char: string) {
  return char.toLocaleLowerCase("ru-RU") !== char.toLocaleUpperCase("ru-RU");
}

function inferMask(example: string) {
  return Array.from(example)
    .map((char) => {
      if (/\p{Number}/u.test(char)) return "9";
      if (isLetter(char)) {
        return char === char.toLocaleUpperCase("ru-RU") ? "A" : "a";
      }
      return "!";
    })
    .join("");
}

function validateMask(mask: string, allowedChars: CharacterSets) {
  if (mask.includes("9") && !allowedChars.digits) return "В маске есть цифры, но в клавиатуре выключены все цифры.";
  if ((mask.includes("A") || mask.includes("a")) && !allowedChars.letters) return "В маске есть буквы, но в клавиатуре выключены все буквы.";
  if (mask.includes("!") && !allowedChars.symbols) return "В маске есть знаки, но в клавиатуре выключены все знаки.";
  return null;
}

function randomIndex(max: number) {
  if (max <= 0) throw new Error("Пустой набор символов.");

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % max;
  }

  return Math.floor(Math.random() * max);
}

function pick(chars: string) {
  const list = Array.from(chars);
  return list[randomIndex(list.length)];
}

function generatePassword(profile: MaskProfile) {
  const validationError = validateMask(profile.mask, profile.allowedChars);
  if (validationError) throw new Error(validationError);

  let password = "";

  for (const token of Array.from(profile.mask)) {
    if (token === "9") password += pick(profile.allowedChars.digits);
    else if (token === "A") password += pick(profile.allowedChars.letters).toLocaleUpperCase("ru-RU");
    else if (token === "a") password += pick(profile.allowedChars.letters).toLocaleLowerCase("ru-RU");
    else if (token === "!") password += pick(profile.allowedChars.symbols);
    else password += token;
  }

  return password;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function selectedCount(group: CharacterGroupKey, allowedChars: CharacterSets) {
  return Array.from(allowedChars[group]).length;
}

export default function PasswordGeneratorAdminPanel() {
  const [profiles, setProfiles] = useState<MaskProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newExample, setNewExample] = useState("");
  const [newAllowedChars, setNewAllowedChars] = useState<CharacterSets>(cloneAllowedChars(DEFAULT_ALLOWED_CHARS));
  const [count, setCount] = useState(5);
  const [generatedPasswords, setGeneratedPasswords] = useState<string[]>([]);
  const [loadedStorage, setLoadedStorage] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useToastSync({
    error,
    clearError: () => setError(null),
    message,
    clearMessage: () => setMessage(null),
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = normalizeProfiles(JSON.parse(raw));
      setProfiles(parsed);
      setActiveProfileId(parsed[0]?.id ?? null);
    } catch {
      setError("Не удалось прочитать сохраненные маски.");
    } finally {
      setLoadedStorage(true);
    }
  }, []);

  useEffect(() => {
    if (!loadedStorage) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  }, [loadedStorage, profiles]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );
  const newMask = useMemo(() => inferMask(newExample.trim()), [newExample]);

  const resetNewProfileForm = useCallback(() => {
    setEditingProfileId(null);
    setNewName("");
    setNewExample("");
    setNewAllowedChars(cloneAllowedChars(DEFAULT_ALLOWED_CHARS));
  }, []);

  const selectProfile = useCallback((profile: MaskProfile) => {
    setActiveProfileId(profile.id);
    setGeneratedPasswords([]);
  }, []);

  const openCreateForm = useCallback(() => {
    resetNewProfileForm();
    setIsCreateOpen(true);
  }, [resetNewProfileForm]);

  const openEditForm = useCallback((profile: MaskProfile) => {
    setEditingProfileId(profile.id);
    setNewName(profile.name);
    setNewExample(profile.example || "");
    setNewAllowedChars(cloneAllowedChars(profile.allowedChars));
    setActiveProfileId(profile.id);
    setGeneratedPasswords([]);
    setIsCreateOpen(true);
  }, []);

  const toggleNewAllowedChar = useCallback((group: CharacterGroupKey, char: string) => {
    setNewAllowedChars((current) => {
      const fullChars = KEYBOARD_GROUPS.find((item) => item.key === group)?.chars ?? "";
      const selected = new Set(Array.from(current[group]));

      if (selected.has(char)) {
        selected.delete(char);
      } else {
        selected.add(char);
      }

      return {
        ...current,
        [group]: Array.from(fullChars)
          .filter((item) => selected.has(item))
          .join(""),
      };
    });
  }, []);

  const setNewAllowedGroup = useCallback((group: CharacterGroupKey, mode: "all" | "none") => {
    const fullChars = KEYBOARD_GROUPS.find((item) => item.key === group)?.chars ?? "";
    setNewAllowedChars((current) => ({
      ...current,
      [group]: mode === "all" ? fullChars : "",
    }));
  }, []);

  const saveProfile = useCallback(() => {
    const name = newName.trim();
    const example = newExample.trim();
    const mask = inferMask(example);

    if (!name) {
      setError("Укажите название маски.");
      return;
    }
    if (!example) {
      setError("Укажите пример пароля.");
      return;
    }
    if (!mask) {
      setError("Не удалось определить маску по примеру.");
      return;
    }

    const validationError = validateMask(mask, newAllowedChars);
    if (validationError) {
      setError(validationError);
      return;
    }

    const existingProfile = editingProfileId
      ? profiles.find((profile) => profile.id === editingProfileId) ?? null
      : null;
    const profile: MaskProfile = {
      id: existingProfile?.id ?? uniqueId(),
      name,
      example,
      mask,
      allowedChars: cloneAllowedChars(newAllowedChars),
      createdAt: existingProfile?.createdAt ?? new Date().toISOString(),
    };

    setProfiles((current) => {
      if (existingProfile) {
        return current.map((item) => (item.id === existingProfile.id ? profile : item));
      }
      return [profile, ...current];
    });
    setActiveProfileId(profile.id);
    resetNewProfileForm();
    setGeneratedPasswords([]);
    setIsCreateOpen(false);
    setMessage(existingProfile ? "Маска обновлена." : "Маска добавлена.");
  }, [editingProfileId, newAllowedChars, newExample, newName, profiles, resetNewProfileForm]);

  const deleteProfile = useCallback(
    (profile: MaskProfile) => {
      if (!confirm(`Удалить маску "${profile.name}"?`)) return;

      setProfiles((current) => {
        const next = current.filter((item) => item.id !== profile.id);
        if (activeProfileId === profile.id) {
          setActiveProfileId(next[0]?.id ?? null);
          setGeneratedPasswords([]);
        }
        if (editingProfileId === profile.id) {
          setIsCreateOpen(false);
          resetNewProfileForm();
        }
        return next;
      });
    },
    [activeProfileId, editingProfileId, resetNewProfileForm]
  );

  const generate = useCallback(() => {
    if (!activeProfile) return;

    try {
      const safeCount = Math.max(1, Math.min(50, Number(count) || 1));
      setGeneratedPasswords(Array.from({ length: safeCount }, () => generatePassword(activeProfile)));
      setMessage("Пароли сгенерированы.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сгенерировать пароли.");
    }
  }, [activeProfile, count]);

  return (
    <div className="grid h-full min-h-0 gap-4 p-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto rounded-[28px] border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Маски</h2>
            <p className="mt-1 text-xs text-slate-500">Добавьте пример пароля, система определит маску.</p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-xl leading-none text-white hover:bg-slate-800"
            aria-label="Добавить маску"
            title="Добавить маску"
          >
            +
          </button>
        </div>

        {isCreateOpen && (
          <div className="mb-4 rounded-[26px] border border-slate-200 bg-white/95 p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              {editingProfileId ? "Редактирование маски" : "Новая маска"}
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Название
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Например: пароль VipNet"
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white/80 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-200"
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Пример пароля
              <input
                value={newExample}
                onChange={(event) => setNewExample(event.target.value)}
                placeholder="205502Fs!"
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white/80 px-3 py-2 font-mono text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-200"
              />
            </label>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Маска</div>
              <code className="mt-1 block min-h-5 break-all font-mono text-sm text-slate-900">
                {newMask || "Будет создана автоматически"}
              </code>
            </div>

            <div className="mt-4 rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Виртуальная клавиатура</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Все символы включены по умолчанию. Выключите те, которые не должны попадать в пароль.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewAllowedChars(cloneAllowedChars(DEFAULT_ALLOWED_CHARS))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Все
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {KEYBOARD_GROUPS.map((group) => {
                  const selected = new Set(Array.from(newAllowedChars[group.key]));
                  const selectedTotal = selectedCount(group.key, newAllowedChars);
                  const total = Array.from(group.chars).length;

                  return (
                    <div key={group.key} className="rounded-2xl border border-slate-200 bg-white/85 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{group.title}</div>
                          <div className="text-[11px] text-slate-400">
                            Токен {group.maskToken} · выбрано {selectedTotal} из {total}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setNewAllowedGroup(group.key, "all")}
                            className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                          >
                            все
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewAllowedGroup(group.key, "none")}
                            className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                          >
                            нет
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(group.chars).map((char) => {
                          const active = selected.has(char);
                          return (
                            <button
                              key={`${group.key}-${char}`}
                              type="button"
                              onClick={() => toggleNewAllowedChar(group.key, char)}
                              className={`flex h-8 min-w-8 items-center justify-center rounded-xl border px-2 font-mono text-xs font-semibold transition-all ${
                                active
                                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                                  : "border-slate-200 bg-slate-100/80 text-slate-400 hover:border-slate-300 hover:text-slate-700"
                              }`}
                              title={active ? "Выключить" : "Включить"}
                            >
                              {char}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  resetNewProfileForm();
                }}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={saveProfile}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {editingProfileId ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-sm text-slate-500">
            Масок пока нет. Нажмите плюс и добавьте свою маску по примеру пароля.
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((profile) => {
              const active = profile.id === activeProfileId;
              return (
                <div
                  key={profile.id}
                  className={`rounded-2xl border p-3 transition-colors ${
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white/80 text-slate-800 hover:bg-white"
                  }`}
                >
                  <button type="button" onClick={() => selectProfile(profile)} className="block w-full text-left">
                    <div className="text-sm font-semibold">{profile.name}</div>
                    <div className={`mt-1 break-all font-mono text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                      {profile.mask}
                    </div>
                  </button>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(profile)}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                        active ? "border border-white/20 text-slate-200 hover:bg-white/10" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                      aria-label="Редактировать маску"
                      title="Редактировать"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteProfile(profile)}
                      className={`rounded-xl px-3 py-1 text-xs ${
                        active ? "border border-white/20 text-slate-200 hover:bg-white/10" : "border border-rose-200 text-rose-700 hover:bg-rose-50"
                      }`}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      <section className="min-h-0 overflow-auto rounded-[28px] border border-slate-200 bg-white/80 p-5">
        <div className="max-w-3xl">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
            <h2 className="text-xl font-semibold text-slate-900">Генерация</h2>
            <p className="mt-2 text-sm text-slate-500">
              Выберите маску слева, укажите количество и сгенерируйте пароли.
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block text-sm font-medium text-slate-700">
                Количество паролей
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value) || 1)}
                  className="mt-2 w-44 rounded-2xl border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-200"
                />
              </label>

              <button
                type="button"
                disabled={!activeProfile}
                onClick={generate}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Генерировать пароль
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-[24px] border border-slate-200 bg-white/80 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">Пароли</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{generatedPasswords.length} шт.</span>
            </div>

            {generatedPasswords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-8 text-sm text-slate-500">
                После генерации пароли появятся здесь.
              </div>
            ) : (
              <div className="space-y-2">
                {generatedPasswords.map((password, index) => (
                  <div key={`${password}-${index}`} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2">
                    <code className="min-w-0 flex-1 break-all px-2 font-mono text-sm text-slate-900">{password}</code>
                    <button
                      type="button"
                      onClick={() => void copyText(password).then(() => setMessage("Пароль скопирован."))}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      aria-label="Скопировать пароль"
                      title="Скопировать"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
