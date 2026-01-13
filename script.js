// ================= UI =================
const statusBox = document.getElementById("statusBox");
const usernameInput = document.getElementById("usernameInput");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(type, title, message) {
  const badgeClass =
    type === "ok" ? "ok" :
    type === "err" ? "err" : "warn";

  statusBox.innerHTML =
    `<span class="badge ${badgeClass}">${title}</span>\n${message}`;
}

function logStatus(msg) {
  statusBox.textContent += `\n${msg}`;
  statusBox.scrollTop = statusBox.scrollHeight;
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// ================= JSZIP =================
async function ensureJSZip() {
  if (window.JSZip) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.0/jszip.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load JSZip"));
    document.head.appendChild(s);
  });
}

// ================= HASH URL (same as your script) =================
function getHashUrl(hash, type = "t") {
  let st = 31;
  for (let ii = 0; ii < hash.length; ii++) st ^= hash[ii].charCodeAt(0);
  return `https://${type}${(st % 8).toString()}.rbxcdn.com/${hash}`;
}

async function fetchText(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (r.type === "opaque") throw new Error("opaque-response (CORS)");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === retries) throw e;
      await sleep(300 + i * 200);
    }
  }
}

async function fetchArrayBuffer(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (r.type === "opaque") throw new Error("opaque-response (CORS)");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.arrayBuffer();
    } catch (e) {
      if (i === retries) throw e;
      await sleep(300 + i * 200);
    }
  }
}

// ================= USERNAME -> USERID (GET + RETRY 429) =================
async function usernameToUserId(username) {
  const r = await fetch("/api/userid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });

  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Username lookup failed");

  return j.id;
}




// ================= MAIN =================
async function downloadAvatarZipByUsername(username) {
  await ensureJSZip();

  setStatus("warn", "Working", "Starting download...\n");

  const userId = await usernameToUserId(username);
  logStatus(`-> Resolved userId: ${userId}`);

  logStatus("-> Fetching thumbnails API...");
  const thumbUrl = `https://thumbnails.roproxy.com/v1/users/avatar-3d?userId=${userId}`;
  const thumbText = await fetchText(thumbUrl);
  const thumbJson = JSON.parse(thumbText);

  let entry = null;
  if (Array.isArray(thumbJson.data) && thumbJson.data.length) entry = thumbJson.data[0];
  else if (thumbJson.imageUrl || thumbJson.targetId) entry = thumbJson;
  else throw new Error("No avatar data returned from thumbnails API.");

  if (!entry.imageUrl) throw new Error("Thumbnails API returned no imageUrl.");

  logStatus("-> Fetching avatar JSON...");
  const imageText = await fetchText(entry.imageUrl);

  let imageJson;
  try {
    imageJson = JSON.parse(imageText);
  } catch {
    throw new Error("Avatar imageUrl did not return JSON.");
  }

  const { obj, mtl, textures } = imageJson;
  if (!obj && !mtl && !textures) throw new Error("Avatar JSON missing obj/mtl/textures.");

  const baseName = `User_${username}_${userId}`;
  const zip = new JSZip();

  // ---- MTL + textures ----
  if (mtl) {
    logStatus("-> Fetching .mtl...");
    const mtlUrl = getHashUrl(mtl);
    const mtlText = await fetchText(mtlUrl);

    const textureFiles = Array.isArray(textures) ? textures : [];
    let replacedMtl = mtlText;

    const textureEntries = [];
    for (let i = 0; i < textureFiles.length; i++) {
      const texHash = textureFiles[i];
      const texUrl = getHashUrl(texHash);
      const texFilename = `texture_${i + 1}.png`;

      replacedMtl = replacedMtl.replace(new RegExp(texHash, "g"), texFilename);
      textureEntries.push({ url: texUrl, filename: texFilename });
    }

    zip.file(`${baseName}.mtl`, replacedMtl);

    for (const t of textureEntries) {
      logStatus(`-> Downloading ${t.filename}...`);
      const ab = await fetchArrayBuffer(t.url);
      zip.file(t.filename, ab);
    }
  }

  // ---- OBJ ----
  if (obj) {
    logStatus("-> Fetching .obj...");
    const objUrl = getHashUrl(obj);
    const objText = await fetchText(objUrl);
    zip.file(`${baseName}.obj`, objText);
  }

  // ---- META ----
  zip.file(`${baseName}_meta.json`, JSON.stringify(imageJson, null, 2));

  logStatus("-> Building ZIP...");
  const blob = await zip.generateAsync({ type: "blob" });

  const dlName = `${baseName}_3D_Files.zip`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = dlName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);

  setStatus("ok", "Done", `Download started!\n\nFile: ${dlName}`);
}

// ================= BUTTONS =================
document.getElementById("downloadBtn").addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  if (!username) {
    setStatus("err", "Error", "Please enter a Roblox username.");
    return;
  }

  downloadBtn.disabled = true;
  downloadBtn.textContent = "Working...";

  try {
    await downloadAvatarZipByUsername(username);
  } catch (err) {
    console.error(err);

    const msg = err?.message || String(err);
    const low = msg.toLowerCase();

    let extra = "";
    if (low.includes("cors") || low.includes("opaque") || low.includes("failed to fetch")) {
      extra =
        "\n\n⚠️ CORS Blocked:\nRoblox CDN often blocks browser download.\nYou’ll need a backend proxy to make it always work.";
    }

    setStatus("err", "Failed", msg + extra);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "Download ZIP";
  }
});


document.getElementById("clearBtn").addEventListener("click", () => {
  setStatus("warn", "Waiting", "Enter a username and click Download ZIP.");
});

// Enter key triggers download
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") downloadBtn.click();
});
