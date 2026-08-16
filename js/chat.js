(function () {
  var mock = document.getElementById("chatMock");
  var scroll = document.getElementById("chatScroll");
  var typing = document.getElementById("mockTyping");
  var roomCount = document.getElementById("roomCount");
  var input = document.getElementById("mockMsg");
  var sendBtn = document.getElementById("mockSend");
  if (!mock || !scroll) return;

  var SEED = scroll.querySelectorAll(".mock-row, .mock-file");
  var seedWait = [0, 700, 1400, 2100, 2800];

  var BOTS = [
    "server: still running. somehow.",
    "who's downloading at 3am??",
    "did we lose power again",
    "that's a lot of files for a tuesday",
    "left the room, be right back",
    "password is still the same, don't tell anyone",
    "kicked my router, we're back",
    "the tv is on the network again, i can't explain it",
    "everyone refresh, new build dropped",
    "my phone joined. again. it does that."
  ];

  var REPLIES = [
    "noted. weirdly.",
    "this is why we can't have nice wifi",
    "saving that to the shared folder",
    "are you the router again?",
    "someone screenshotted this. the server knows.",
    "ok. bold move for a lan.",
    "the file drop is watching you now"
  ];

  var fileCount = 2;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  function addBubble(text, me) {
    var row = el("div", "mock-row " + (me ? "me" : "them"));
    var b = el("div", "bubble", text);
    row.appendChild(b);
    scroll.appendChild(row);
    row.style.animation = "bubpop .35s cubic-bezier(.2,.9,.3,1.2) both";
    scroll.scrollTop = scroll.scrollHeight;
    return row;
  }

  function addFile(name, bytes) {
    var f = el("div", "mock-file");
    var ic = el("span", null, "📦");
    var nm = el("span", null, name);
    var meta = el("span", "file-meta", "from " + BOTS[Math.floor(Math.random() * BOTS.length)].split(" ")[0]);
    var sz = el("span", "file-size", fmtSize(bytes));
    var dl = el("span", "file-dl", "↓ " + (1 + Math.floor(Math.random() * 4)) + "×");
    f.appendChild(ic); f.appendChild(nm); f.appendChild(meta); f.appendChild(sz); f.appendChild(dl);
    scroll.appendChild(f);
    f.style.animation = "bubpop .4s cubic-bezier(.2,.9,.3,1.2) both";
    scroll.scrollTop = scroll.scrollHeight;
  }

  function showTyping() { typing.style.opacity = "1"; }
  function hideTyping() { typing.style.opacity = "0"; }

  var busy = false;
  function botLoop() {
    if (busy) return;
    busy = true;
    showTyping();
    setTimeout(function () {
      hideTyping();
      addBubble(BOTS[Math.floor(Math.random() * BOTS.length)], false);
      busy = false;
      bumpCount();
      setTimeout(botLoop, 3800 + Math.random() * 4200);
    }, 1500 + Math.random() * 1200);
  }

  function bumpCount() {
    if (!roomCount) return;
    var n = 3 + Math.floor(Math.random() * 6);
    roomCount.textContent = String(n);
  }
  setInterval(bumpCount, 5200);

  if (sendBtn) {
    sendBtn.addEventListener("click", sendMsg);
  }
  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); sendMsg(); }
    });
  }

  function sendMsg() {
    if (!input) return;
    var v = input.value.trim();
    if (!v) return;
    addBubble(v, true);
    input.value = "";
    var replyAt = 900 + Math.random() * 900;
    setTimeout(function () {
      showTyping();
      setTimeout(function () {
        hideTyping();
        addBubble(REPLIES[Math.floor(Math.random() * REPLIES.length)], false);
      }, 1100 + Math.random() * 700);
    }, replyAt);
  }

  /* ---- drag & drop a file onto the chat ---- */
  ["dragenter", "dragover"].forEach(function (ev) {
    mock.addEventListener(ev, function (e) {
      e.preventDefault();
      mock.classList.add("drop");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    mock.addEventListener(ev, function (e) {
      e.preventDefault();
      mock.classList.remove("drop");
    });
  });
  mock.addEventListener("drop", function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) {
      for (var i = 0; i < Math.min(files.length, 4); i++) {
        addFile(files[i].name || "untitled.bin", files[i].size || 1024 * (1 + Math.floor(Math.random() * 4000)));
      }
      fileCount++;
    }
  });

  /* ---- reveal seed bubbles ---- */
  Array.prototype.forEach.call(SEED, function (node) {
    node.style.visibility = "hidden";
  });
  var revealed = 0;
  function revealNext() {
    if (revealed >= SEED.length) {
      setTimeout(botLoop, 1600);
      return;
    }
    var node = SEED[revealed];
    node.style.visibility = "visible";
    node.style.animation = "bubpop .4s cubic-bezier(.2,.9,.3,1.2) both";
    revealed++;
    setTimeout(revealNext, seedWait[revealed] || 900);
  }
  setTimeout(revealNext, 400);

  /* ---- floating background bubbles ---- */
  var BUB_COLORS = ["#7dd3fc", "#22c55e", "#e6e6e6"];
  for (var i = 0; i < 14; i++) {
    var b = document.createElement("span");
    b.className = "fbubble";
    var size = 8 + Math.random() * 18;
    b.style.width = size.toFixed(1) + "px";
    b.style.height = size.toFixed(1) + "px";
    b.style.left = (Math.random() * 100).toFixed(2) + "%";
    b.style.bottom = "-40px";
    b.style.background = BUB_COLORS[i % 3];
    b.style.animationDuration = (9 + Math.random() * 12).toFixed(1) + "s";
    b.style.animationDelay = (-Math.random() * 20).toFixed(1) + "s";
    b.style.opacity = (0.05 + Math.random() * 0.12).toFixed(2);
    document.body.appendChild(b);
  }

  /* ---- scroll reveal ---- */
  var revealIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(function (el, i) {
    el.style.setProperty("--d", String((i % 4) * 0.07) + "s");
    revealIO.observe(el);
  });
})();
