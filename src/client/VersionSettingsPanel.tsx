import { useEffect, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import changelog from "../../releases/changelog.json";
import { browserBuildInfo } from "./build-info";
import type {
  UpdatePreferences,
  UpdateState,
} from "../shared/desktop-contract";
import { UpdateControls, updateStatus } from "./UpdateControls";
import "./desktop";

type ReleaseNotes = {
  version: string;
  date?: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
};
const releases: ReleaseNotes[] = changelog;
const groups = [
  ["added", "Новое"],
  ["changed", "Улучшения"],
  ["fixed", "Исправления"],
] as const;

function Notes({ release }: { release: ReleaseNotes }) {
  return groups.map(([key, title]) =>
    release[key]?.length ? (
      <div className="settings-changelog-group" key={key}>
        <h4>{title}</h4>
        <ul>
          {release[key]!.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    ) : null,
  );
}

export function VersionSettingsPanel() {
  const desktop = window.harborPlayerDesktop;
  const [appInfo, setAppInfo] = useState<{
    version: string;
    commit: string;
    portable?: boolean;
  }>(browserBuildInfo);
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [preferences, setPreferences] = useState<UpdatePreferences | null>(
    null,
  );
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = desktop.subscribeUpdateState((next) => {
      receivedUpdate = true;
      if (active) setState(next);
    });
    void desktop
      .getAppInfo()
      .then((info) => {
        if (active) setAppInfo(info);
      })
      .catch(() => {});
    void desktop
      .getUpdateState()
      .then((next) => {
        if (active && !receivedUpdate) setState(next);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void desktop
      .getUpdatePreferences()
      .then((next) => {
        if (active) setPreferences(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [desktop, state.notificationId, state.notificationHidden]);
  const current = releases.find(
    (release) => release.version === appInfo.version,
  );
  const previous = releases.filter((release) => release !== current);
  const busy =
    checking ||
    ["checking", "downloading", "preparingInstall"].includes(state.status);
  const savePreferences = async (next: Partial<UpdatePreferences>) => {
    if (!desktop || savingPreferences) return;
    setSavingPreferences(true);
    setError("");
    try {
      setPreferences(await desktop.setUpdatePreferences(next));
    } catch {
      setError(
        "Не удалось сохранить настройки обновления. Попробуйте ещё раз.",
      );
    } finally {
      setSavingPreferences(false);
    }
  };
  return (
    <section className="panel settings-panel" aria-label="Версия и обновления">
      <header className="panel-heading settings-panel-heading">
        <Info size={17} />
        <h2>Версия и обновления</h2>
      </header>
      <div className="settings-panel-body appearance-settings">
        <div className="appearance-section">
          <div className="settings-version">
            <strong>HARBOR {appInfo.version.split("-")[0]}</strong>
            {appInfo.version.includes("-") && (
              <span className="settings-version-badge">
                {appInfo.version
                  .split("-")
                  .slice(1)
                  .join("-")
                  .replace(/\./g, " ")}
              </span>
            )}
          </div>
          <span className="settings-build">Сборка {appInfo.commit}</span>
          {desktop && appInfo.portable === false && preferences && (
            <label className="settings-update-toggle">
              <input
                type="checkbox"
                checked={preferences.automaticChecks}
                disabled={savingPreferences}
                onChange={(event) =>
                  void savePreferences({
                    automaticChecks: event.target.checked,
                  })
                }
              />
              Автоматически проверять обновления
            </label>
          )}
          {desktop && (
            <button
              type="button"
              className="button secondary settings-update-button"
              disabled={busy}
              onClick={async () => {
                setChecking(true);
                setError("");
                try {
                  await desktop.checkForUpdates();
                } catch {
                  setError(
                    "Не удалось проверить обновления. Попробуйте позже.",
                  );
                } finally {
                  setChecking(false);
                }
              }}
            >
              <RefreshCw
                size={15}
                className={busy ? "is-spinning" : undefined}
              />
              {checking || state.status === "checking"
                ? "Проверяем обновления…"
                : "Проверить обновления"}
            </button>
          )}
          {desktop && updateStatus(state) && (
            <p
              className={`settings-update-status ${state.status === "error" ? "error-text" : "hint"}`}
              role="status"
            >
              {updateStatus(state)}
            </p>
          )}
          {desktop && (
            <UpdateControls
              key={state.notificationId}
              state={state}
              desktop={desktop}
              onPreferencesChange={setPreferences}
            />
          )}
          {desktop && preferences?.skippedVersion && (
            <p className="hint settings-update-status">
              Пропущена версия {preferences.skippedVersion}. Ручная проверка
              позволит вернуться к обновлению.
            </p>
          )}
          {error && (
            <p className="error-text settings-update-status" role="alert">
              {error}
            </p>
          )}
        </div>
        <section className="appearance-section settings-changelog">
          <h3>Что нового</h3>
          {current ? (
            <div className="settings-current-release">
              <div className="settings-release-heading">
                <strong>{current.version}</strong>
                {current.date && (
                  <time dateTime={current.date}>{current.date}</time>
                )}
              </div>
              <Notes release={current} />
            </div>
          ) : (
            <p className="hint">
              Для этой версии список изменений ещё не добавлен.
            </p>
          )}
          {previous.map((release) => (
            <details
              key={release.version}
              className="settings-previous-release"
            >
              <summary>
                {release.version}
                {release.date && (
                  <time dateTime={release.date}>{release.date}</time>
                )}
              </summary>
              <Notes release={release} />
            </details>
          ))}
        </section>
      </div>
    </section>
  );
}
