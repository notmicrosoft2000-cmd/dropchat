const params = new URLSearchParams(location.search);
const key = params.get("key") || "";
const keyArg = key ? "?key=" + encodeURIComponent(key) : "";

const $ = (id) => document.getElementById(id);

function pickName() {
  let n = localStorage.getItem("dropchat_name");
  if (!n) {
    n = "Friend-" + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem("dropchat_name", n);
  }
  return n;
}

const myName = pickName();
$("name").value = myName;

fetch("/api/info" + keyArg)
  .then((r) => r.json())
  .then((info) => {
    $("share-url").textContent = "http://" + info.lan + "/";
  })
  .catch(() => {
    $("share-url").textContent = location.origin;
  });

const esParams = new URLSearchParams({ name: myName });
if (key) esParams.set("key", key);
const ws = new EventSource("/events?" + esParams.toString());

ws.addEventListener("history", (e) => {
  const list = JSON.parse(e.data);
  list.forEach((m) => addMessage(m, true));
  scrollDown();
});

ws.addEventListener("message", (e) => {
  addMessage(JSON.parse(e.data), false);
  scrollDown();
});

ws.addEventListener("users", (e) => {
  const users = JSON.parse(e.data);
  $("users").innerHTML = users
    .map(
      (u) =>
        `<div><span class="dot">&#9679;</span>${escapeHtml(u)}${
          u === myName ? ' <span class="you">(you)</span>' : ""
        }</div>`
    )
    .join("") || '<div class="empty">Just you.</div>';
});

ws.addEventListener("typing", (e) => {
  const names = JSON.parse(e.data).filter((n) => n !== myName);
  const el = $("typing");
  if (!el) return;
  if (!names.length) {
    el.textContent = "";
    return;
  }
  el.textContent =
    names.join(", ") + (names.length > 1 ? " are" : " is") + " typing...";
});

ws.addEventListener("joined", (e) => {
  const d = JSON.parse(e.data);
  if (d.name !== myName) addSystem(d.name + " joined the room");
});

ws.addEventListener("left", (e) => {
  const d = JSON.parse(e.data);
  if (d.name !== myName) addSystem(d.name + " left the room");
});

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "system";
  div.textContent = text;
  $("messages").appendChild(div);
  scrollDown();
}

ws.addEventListener("file", (e) => {
  const f = JSON.parse(e.data);
  $("files").insertAdjacentHTML(
    "beforeend",
    `<div class="file-notice" style="max-width:none;align-self:auto">New file: <b>${escapeHtml(f.name)}</b> (${fmtSize(f.size)})</div>`
  );
  loadFiles();
});

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function addMessage(m, mine) {
  const div = document.createElement("div");
  div.className = "msg" + (mine ? " mine" : "");
  div.innerHTML =
    `<div class="when">${escapeHtml(m.time)}</div>` +
    `<div class="who">${escapeHtml(m.name)}</div>` +
    `<div class="text">${escapeHtml(m.message)}</div>`;
  $("messages").appendChild(div);
}

function scrollDown() {
  $("messages").scrollTop = $("messages").scrollHeight;
}

function send() {
  const name = $("name").value.trim() || "Guest";
  const message = $("msg").value.trim();
  if (!message) return;
  typingStopSend();
  localStorage.setItem("dropchat_name", name);
  fetch("/send" + keyArg, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, message }),
  });
  $("msg").value = "";
  $("msg").focus();
}

let typingSent = false;
let typingTimer = null;

function typingPing() {
  const name = $("name").value.trim() || "Guest";
  clearTimeout(typingTimer);
  if (!typingSent) {
    typingSent = true;
    fetch("/typing" + keyArg, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, typing: true }),
    });
  }
  typingTimer = setTimeout(typingStopSend, 2500);
}

function typingStopSend() {
  clearTimeout(typingTimer);
  if (!typingSent) return;
  typingSent = false;
  const name = $("name").value.trim() || "Guest";
  fetch("/typing" + keyArg, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, typing: false }),
  });
}

$("send").addEventListener("click", send);
$("msg").addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});
$("msg").addEventListener("input", typingPing);
$("name").addEventListener("input", typingPing);

const dropzone = $("dropzone");
const fileInput = $("file-input");

function upload(file) {
  const name = $("name").value.trim() || "Guest";
  const form = new FormData();
  form.append("file", file);
  const qs = keyArg
    ? keyArg + "&name=" + encodeURIComponent(name)
    : "?name=" + encodeURIComponent(name);
  fetch("/upload" + qs, { method: "POST", body: form })
    .then((r) => (r.ok ? loadFiles() : r.json().then((j) => alert("Upload failed: " + j.error))))
    .catch(() => alert("Upload failed"));
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  [...fileInput.files].forEach(upload);
  fileInput.value = "";
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("over");
  [...e.dataTransfer.files].forEach(upload);
});

function loadFiles() {
  fetch("/api/files" + keyArg)
    .then((r) => r.json())
    .then((files) => {
      $("files").innerHTML =
        files
          .map(
            (f) =>
              `<div class="frow">` +
              `<span class="fico">&#128196;</span>` +
              `<a class="fname" href="/download/${encodeURIComponent(f.id)}">${escapeHtml(f.name)}</a>` +
              `<span class="fmeta">${fmtSize(f.size)}${f.uploaded_by ? " · from " + escapeHtml(f.uploaded_by) : ""}${f.time ? " · " + escapeHtml(f.time) : ""}${expiryText(f.expires)}</span>` +
              `<button class="fdel" data-id="${encodeURIComponent(f.id)}" title="Delete file">&times;</button>` +
              `</div>`
          )
          .join("") || '<div class="empty">No files yet. Drop something above.</div>';
    });
}

function expiryText(expires) {
  if (!expires) return "";
  const mins = Math.max(1, Math.round(expires - Date.now() / 1000) / 60);
  if (mins >= 60) return " · expires in " + Math.round(mins / 60) + "h";
  return " · expires in " + Math.round(mins) + "m";
}

$("files").addEventListener("click", (e) => {
  const btn = e.target.closest(".fdel");
  if (!btn) return;
  const id = decodeURIComponent(btn.getAttribute("data-id"));
  fetch("/api/files/" + encodeURIComponent(id) + keyArg, { method: "DELETE" })
    .then((r) => (r.ok ? loadFiles() : null))
    .catch(() => {});
});

ws.addEventListener("file-deleted", (e) => {
  const f = JSON.parse(e.data);
  loadFiles();
  const box = $("files");
  if (box) {
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="file-notice" style="max-width:none;align-self:auto">File removed: <b>${escapeHtml(f.name)}</b></div>`
    );
  }
});

$("find").addEventListener("click", () => {
  $("found").innerHTML = '<div class="empty">Looking...</div>';
  fetch("/api/discover" + keyArg)
    .then((r) => r.json())
    .then((servers) => {
      $("found").innerHTML =
        servers
          .map(
            (s) =>
              `<div>&#128225; <b>${escapeHtml(s.name)}</b> &rarr; <a href="http://${s.ip}:${s.port}">http://${s.ip}:${s.port}</a></div>`
          )
          .join("") || '<div class="empty">No other DropChat found right now.</div>';
    });
});

$("scan").addEventListener("click", () => {
  $("wifi").innerHTML = '<div class="empty">Scanning...</div>';
  fetch("/api/wifi" + keyArg)
    .then((r) => r.json())
    .then((devices) => {
      $("wifi").innerHTML =
        devices
          .map(
            (d) =>
              `<div><span>${escapeHtml(d.ip)}</span><span style="color:#5f6b82">${escapeHtml(d.type)}</span></div>`
          )
          .join("") || '<div class="empty">Nothing found.</div>';
    });
});

loadFiles();
