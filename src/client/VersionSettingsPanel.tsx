import { useEffect, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import changelog from "../../releases/changelog.json";
import { browserBuildInfo } from "./build-info";
import type { UpdateState } from "../shared/desktop-contract";
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

function updateStatus(state: UpdateState) {
  switch (state.status) {
    case "idle":
      return "";
    case "checking":
      return "Проверяем обновления…";
    case "upToDate":
      return "Установлена актуальная версия";
    case "available":
      return `Доступна версия ${state.version}`;
    case "downloading":
      return `Загрузка ${state.version}: ${Math.round(state.percent)}%`;
    case "downloaded":
      return `Версия ${state.version} готова к установке`;
    case "preparingInstall":
      return "Подготовка к установке…";
    case "unsupported":
      return "Автоматическое обновление недоступно для этой сборки";
    case "error":
      return state.message;
  }
}

export function VersionSettingsPanel() {
  const desktop = window.harborPlayerDesktop;
  const [appInfo, setAppInfo] = useState(browserBuildInfo);
  const [state, setState] = useState<UpdateState>({ status: "idle" });
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
      .then(({ version, commit }) => {
        if (active) setAppInfo({ version, commit });
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
  const current = releases.find(
    (release) => release.version === appInfo.version,
  );
  const previous = releases.filter((release) => release !== current);
  const busy =
    checking ||
    ["checking", "downloading", "preparingInstall"].includes(state.status);
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
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
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
              className={state.status === "error" ? "error-text" : "hint"}
              role="status"
            >
              {updateStatus(state)}
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
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
