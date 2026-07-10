import type { FC } from "hono/jsx";

const EXAMPLE_SYMPTOMS = [
  "秒針が5秒おきに飛んで止まる",
  "針がぶつかって止まる",
  "電池を交換しても動かない",
  "時刻が遅れる",
  "液晶が暗い",
  "リュウズが回らない",
] as const;

const clientScript = `
(function () {
  var form = document.getElementById("diagnose-form");
  var input = document.getElementById("symptom-input");
  var submitBtn = document.getElementById("submit-btn");
  var resultArea = document.getElementById("result-area");
  var errorArea = document.getElementById("error-area");
  var chips = document.querySelectorAll("[data-symptom]");

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.textContent = loading ? "診断中…" : "診断する";
  }

  function hideResult() {
    resultArea.classList.add("hidden");
    resultArea.innerHTML = "";
  }

  function hideError() {
    errorArea.classList.add("hidden");
    errorArea.textContent = "";
  }

  function showError(message) {
    hideResult();
    errorArea.textContent = message;
    errorArea.classList.remove("hidden");
  }

  function formatConfidence(value) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    return Math.round(value * 100) + "%";
  }

  function showResult(data) {
    hideError();
    var partLabel = data.part == null ? "診断不可" : data.part;
    var isFallback = data.part == null;
    resultArea.innerHTML =
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">' +
      '<div class="mb-4 flex items-start justify-between gap-3">' +
      '<div>' +
      '<p class="text-xs font-medium uppercase tracking-wide text-slate-500">推定部品</p>' +
      '<p class="mt-1 text-2xl font-semibold text-slate-900">' +
      escapeHtml(partLabel) +
      "</p>" +
      "</div>" +
      '<div class="rounded-full px-3 py-1 text-sm font-medium ' +
      (isFallback
        ? "bg-slate-100 text-slate-600"
        : "bg-indigo-50 text-indigo-700") +
      '">' +
      "確信度 " +
      formatConfidence(data.confidence) +
      "</div>" +
      "</div>" +
      '<div class="space-y-3 border-t border-slate-100 pt-4">' +
      '<div>' +
      '<p class="text-xs font-medium uppercase tracking-wide text-slate-500">理由</p>' +
      '<p class="mt-1 text-[15px] leading-relaxed text-slate-800">' +
      escapeHtml(data.reason || "") +
      "</p>" +
      "</div>" +
      '<div>' +
      '<p class="text-xs font-medium uppercase tracking-wide text-slate-500">次のアクション</p>' +
      '<p class="mt-1 text-[15px] leading-relaxed text-slate-800">' +
      escapeHtml(data.nextAction || "") +
      "</p>" +
      "</div>" +
      "</div>" +
      "</div>";
    resultArea.classList.remove("hidden");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var symptom = chip.getAttribute("data-symptom") || "";
      input.value = symptom;
      input.focus();
    });
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var symptom = (input.value || "").trim();
    if (!symptom) {
      showError("症状を入力してください。");
      return;
    }

    hideError();
    hideResult();
    setLoading(true);

    try {
      var res = await fetch("/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptom: symptom }),
      });
      var data = await res.json().catch(function () {
        return {};
      });

      if (!res.ok) {
        showError(data.error || "サーバーエラーが発生しました。(" + res.status + ")");
        return;
      }

      if (typeof data.error === "string") {
        showError(data.error);
        return;
      }

      showResult(data);
    } catch (err) {
      showError("通信に失敗しました。しばらく経ってからお試しください。");
    } finally {
      setLoading(false);
    }
  });
})();
`;

export const DiagnosisPage: FC = () => {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>WatchKarte — 時計故障診断</title>
        <meta
          name="description"
          content="クォーツアナログ時計の症状から、故障部品と次のアクションを診断します。"
        />
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              tailwind.config = {
                theme: {
                  extend: {
                    colors: {
                      brand: {
                        50: '#eef2ff',
                        600: '#4f46e5',
                        700: '#4338ca',
                        900: '#1e1b4b',
                      },
                    },
                  },
                },
              };
            `,
          }}
        />
      </head>
      <body class="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col bg-white shadow-[0_0_0_1px_#f0f0f0]">
          <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3.5 backdrop-blur">
            <div class="flex items-center gap-2.5">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-700 text-sm font-bold text-white">
                W
              </div>
              <div>
                <h1 class="text-base font-semibold tracking-tight text-slate-900">
                  WatchKarte
                </h1>
                <p class="text-xs text-slate-500">クォーツアナログ時計の故障診断</p>
              </div>
            </div>
          </header>

          <main class="flex-1 px-4 py-5">
            <section class="mb-6">
              <h2 class="text-lg font-semibold text-slate-900">症状を入力</h2>
              <p class="mt-1 text-sm leading-relaxed text-slate-500">
                時計の不具合をそのまま書いてください。専門用語は不要です。
              </p>

              <form id="diagnose-form" class="mt-4 space-y-3">
                <label class="sr-only" for="symptom-input">
                  症状
                </label>
                <textarea
                  id="symptom-input"
                  name="symptom"
                  rows={4}
                  placeholder="例: 秒針が5秒おきに飛んで止まる"
                  class="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                ></textarea>
                <button
                  id="submit-btn"
                  type="submit"
                  class="w-full rounded-2xl bg-indigo-700 px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-indigo-800 active:bg-indigo-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  診断する
                </button>
              </form>
            </section>

            <section class="mb-6">
              <p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                例示症状
              </p>
              <div class="flex flex-wrap gap-2">
                {EXAMPLE_SYMPTOMS.map((symptom) => (
                  <button
                    type="button"
                    data-symptom={symptom}
                    class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                  >
                    {symptom}
                  </button>
                ))}
              </div>
            </section>

            <div
              id="error-area"
              class="mb-4 hidden rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700"
              role="alert"
            ></div>

            <section id="result-area" class="hidden" aria-live="polite"></section>
          </main>

          <footer class="border-t border-slate-200 px-4 py-4">
            <p class="text-xs leading-relaxed text-slate-500">
              この診断は参考情報です。重要な修理や分解作業は、専門の時計修理店へご相談ください。
            </p>
          </footer>
        </div>

        <script dangerouslySetInnerHTML={{ __html: clientScript }} />
      </body>
    </html>
  );
};
