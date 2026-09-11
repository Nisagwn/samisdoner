/**
 * Geliştirme sunucusunu **her zaman aynı portta ve tek kopya** başlatır.
 *
 * Neden gerekli:
 *
 *  1. `next dev` port doluysa sessizce bir sonrakine kayar (3000 → 3001 → …).
 *     Tarayıcıda hâlâ 3000 açıktır; oradaki eski süreç çökmüşse "sunucuya
 *     ulaşılamıyor" görürsün. Kayan port ayrıca NEXT_PUBLIC_APP_URL ve Stripe
 *     yönlendirmelerini bozar: ikisi de 3000'e sabittir.
 *
 *  2. Terminal kapansa ya da paket yöneticisi (bun/npm) çıksa bile Next'in
 *     asıl sunucusu ayrı bir alt süreçtir (next/dist/server/lib/start-server.js)
 *     ve Windows'ta yetim kalıp portu tutmaya devam eder. Bir sonraki
 *     `bun dev` bu yüzden başka porta düşer.
 *
 *  3. Aynı `.next` dizinine yazan iki Turbopack süreci Windows'ta dosya
 *     kilidine takılır (EPERM/EBUSY); manifest bozulur, sunucu kendiliğinden
 *     düşer.
 *
 * Bu yüzden başlamadan önce porttaki **bu projeye ait** süreçler kapatılır,
 * port açıkça sabitlenir ve çıkışta tüm süreç ağacı toplanır.
 */

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = String(process.env.PORT || 3000);
const isWindows = process.platform === "win32";
const useTurbo = !process.argv.includes("--webpack");

/** Yol karşılaştırmaları ayırıcıya duyarlı olmasın diye tek biçime indirger. */
function normalizePath(value) {
  return value.split(path.win32.sep).join("/").toLowerCase();
}

const ROOT_KEY = normalizePath(ROOT);

/** Portu dinleyen süreçlerin pid listesi. */
function listenersOn(port) {
  try {
    if (isWindows) {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(line);
        if (match && match[2] === String(port)) pids.add(Number(match[3]));
      }
      return [...pids];
    }
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return []; // dinleyen yoksa araçlar sıfırdan farklı çıkış kodu döndürür
  }
}

/** Sürecin komut satırı — sahibinin biz olup olmadığını anlamak için. */
function commandLineOf(pid) {
  try {
    if (isWindows) {
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: "utf8" }
      );
      return out.trim();
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Süreç bu projenin dev sunucusu mu?
 *
 * Başka bir uygulama portu tutuyorsa asla öldürmeyiz: komut satırında hem proje
 * kökü hem Next izi aranır.
 */
function isOurDevServer(commandLine) {
  const normalized = normalizePath(commandLine);
  return normalized.includes(ROOT_KEY) && /next|start-server/.test(normalized);
}

/** Süreç ağacını (alt süreçleriyle birlikte) kapatır. */
function killTree(pid) {
  if (!pid) return;
  try {
    if (isWindows) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* süreç zaten gitmiş olabilir */
  }
}

/** Portu boşaltır. Sahibi biz değilsek dokunmaz, durumu açıklayıp çıkar. */
function freePort(port) {
  const pids = listenersOn(port).filter((pid) => pid !== process.pid);
  if (pids.length === 0) return;

  const foreign = [];
  for (const pid of pids) {
    const commandLine = commandLineOf(pid);
    if (isOurDevServer(commandLine)) {
      console.log(`• ${port} portunda kalmış eski dev sunucusu kapatılıyor (pid ${pid}).`);
      killTree(pid);
    } else {
      foreign.push({ pid, commandLine });
    }
  }

  if (foreign.length > 0) {
    const listed = foreign
      .map((item) => `  pid ${item.pid}  ${item.commandLine || "(komut satırı okunamadı)"}`)
      .join("\n");
    console.error(
      `\n${port} portunu bu projeye ait olmayan bir süreç tutuyor:\n${listed}\n\n` +
        `Onu kapat ya da başka bir port seç:  PORT=3001 bun dev\n`
    );
    process.exit(1);
  }
}

/**
 * Porta bağlı olmayan yetim süreçler.
 *
 * Turbopack'in yan süreçleri (.next/transform.js gibi) portu dinlemez ama aynı
 * `.next` dizinine yazar; kalırlarsa yeni sunucuyla dosya kilidi için yarışır.
 */
function killOrphanedProjectProcesses() {
  if (!isWindows) return;

  let rows = [];
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(out || "[]");
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return; // temizlik en iyi çabadır; başarısızlığı başlatmayı engellememeli
  }

  for (const row of rows) {
    if (!row || !row.CommandLine || row.ProcessId === process.pid) continue;
    const commandLine = normalizePath(String(row.CommandLine));
    if (!commandLine.includes(ROOT_KEY)) continue;
    if (!/next\/dist|\.next(-dev)?\/transform/.test(commandLine)) continue;
    console.log(`• Yetim Next süreci kapatılıyor (pid ${row.ProcessId}).`);
    killTree(row.ProcessId);
  }
}

freePort(PORT);
killOrphanedProjectProcesses();

const args = ["dev", "--port", PORT];
if (useTurbo) args.push("--turbo");

const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, ...args], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, PORT },
});

// Ctrl+C'de ya da terminal kapanınca sunucu ağacını da topla: yetim süreç
// kalırsa bir sonraki başlatma yine port kaydırır.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(child.pid);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    shutdown();
    process.exit(0);
  });
}
process.on("exit", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
