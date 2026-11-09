/**
 * Dashboard sengaja satu berkas tanpa build step. Semua state bisnis datang
 * dari API gateway, jadi tidak ada salinan data di browser.
 */
export function dashboardPage(version: string): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rann Code Gateway</title>
<style>
:root{--bg:#0b0c0f;--panel:#12141a;--line:#232733;--text:#e8eaf0;--muted:#8b93a7;--accent:#7c9cff;--ok:#49d17d;--warn:#ffc857;--bad:#ff6b6b;--radius:12px}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
button,input,textarea,select{font:inherit;color:inherit}
a{color:var(--accent)}
.hidden{display:none!important}
.login{min-height:100%;display:grid;place-items:center;padding:24px}
.login .card{width:min(420px,100%);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:28px}
.login h1{margin:0 0 4px;font-size:20px}
.login p{margin:0 0 20px;color:var(--muted)}
label{display:block;font-size:12px;color:var(--muted);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.04em}
input,textarea,select{width:100%;background:#0e1015;border:1px solid var(--line);border-radius:8px;padding:10px 12px;outline:none}
input:focus,textarea:focus{border-color:var(--accent)}
button{background:var(--accent);color:#0b0c0f;border:0;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer}
button.secondary{background:#1b1f2a;color:var(--text);border:1px solid var(--line)}
button.danger{background:var(--bad);color:#1a0505}
button:disabled{opacity:.5;cursor:not-allowed}
.shell{display:grid;grid-template-columns:220px 1fr;height:100%}
aside{background:#0e1015;border-right:1px solid var(--line);padding:16px;display:flex;flex-direction:column;gap:4px;overflow:auto}
.brand{font-weight:700;letter-spacing:.02em;margin-bottom:12px}
.brand small{display:block;color:var(--muted);font-weight:400;font-size:11px}
.nav{display:block;padding:8px 10px;border-radius:8px;color:var(--muted);text-decoration:none;cursor:pointer}
.nav:hover{background:#171a22;color:var(--text)}
.nav.active{background:#1b2237;color:var(--text)}
.spacer{flex:1}
main{overflow:auto;padding:24px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.top h2{margin:0;font-size:20px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;background:#1b1f2a;border:1px solid var(--line);font-size:12px;color:var(--muted)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.metric{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.metric b{display:block;font-size:24px;margin-top:4px}
.metric span{color:var(--muted);font-size:12px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-top:16px;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0;background:var(--panel)}
tr:last-child td{border-bottom:0}
.empty,.error{padding:28px;text-align:center;color:var(--muted)}
.error{color:var(--bad)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.chat{display:grid;grid-template-rows:1fr auto;height:calc(100vh - 150px);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.messages{overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:80%;padding:10px 12px;border-radius:10px;white-space:pre-wrap;word-break:break-word}
.msg.user{align-self:flex-end;background:#23304f}
.msg.assistant{align-self:flex-start;background:#1a1e27}
.msg.tool{align-self:flex-start;background:#171a22;color:var(--muted);font-family:ui-monospace,monospace;font-size:12px}
.composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line)}
.composer textarea{resize:none;height:52px}
.status{font-size:12px;color:var(--muted)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
@media(max-width:760px){.shell{grid-template-columns:1fr}.shell aside{position:fixed;z-index:5;inset:0 auto 0 0;width:220px;transform:translateX(-100%);transition:transform .2s}.shell aside.open{transform:none}.menu{display:inline-block}main{padding:16px}.msg{max-width:92%}}
.menu{display:none;background:#1b1f2a;border:1px solid var(--line)}
</style>
</head>
<body>
<div id="login" class="login">
  <div class="card">
    <h1>Rann Code Gateway</h1>
    <p>Masukkan kode pairing 8 karakter dari <span class="mono">rann gateway pair</span>.</p>
    <label for="code">Kode pairing</label>
    <input id="code" maxlength="8" autocomplete="one-time-code" placeholder="ABCD2345">
    <label for="name">Nama perangkat</label>
    <input id="name" placeholder="laptop-randi">
    <div style="margin-top:18px"><button id="pair">Hubungkan</button></div>
    <div id="loginError" class="error hidden"></div>
  </div>
</div>

<div id="app" class="shell hidden">
  <aside id="sidebar">
    <div class="brand">Rann Code<small id="version">gateway</small></div>
    <a class="nav" data-page="overview">Overview</a>
    <a class="nav" data-page="chat">Chat</a>
    <a class="nav" data-page="sessions">Sessions</a>
    <a class="nav" data-page="tasks">Tasks</a>
    <a class="nav" data-page="agents">Agents</a>
    <a class="nav" data-page="plans">Plans</a>
    <a class="nav" data-page="models">Models</a>
    <a class="nav" data-page="providers">Providers</a>
    <a class="nav" data-page="skills">Skills</a>
    <a class="nav" data-page="memory">Memory</a>
    <a class="nav" data-page="tools">Tools</a>
    <a class="nav" data-page="mcp">MCP</a>
    <a class="nav" data-page="plugins">Plugins</a>
    <a class="nav" data-page="scheduler">Scheduler</a>
    <a class="nav" data-page="gateway">Gateway</a>
    <a class="nav" data-page="usage">Usage</a>
    <a class="nav" data-page="logs">Logs</a>
    <a class="nav" data-page="permissions">Permissions</a>
    <a class="nav" data-page="settings">Settings</a>
    <div class="spacer"></div>
    <button class="secondary" id="logout">Keluar</button>
  </aside>
  <main>
    <div class="top">
      <button class="menu" id="menu">Menu</button>
      <h2 id="title">Overview</h2>
      <span class="badge"><span class="dot"></span><span id="deviceName">-</span></span>
      <span class="badge" id="clock"></span>
    </div>
    <div id="view"></div>
  </main>
</div>

<script>
(function(){
  var token = localStorage.getItem("rann_token") || "";
  var device = null;
  var socket = null;
  var currentPage = "overview";
  var chatSession = null;
  var view = document.getElementById("view");
  var login = document.getElementById("login");
  var app = document.getElementById("app");

  function esc(value){
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function api(path, options){
    options = options || {};
    var headers = options.headers || {};
    headers["authorization"] = "Bearer " + token;
    if (options.body && !(options.body instanceof Blob)) headers["content-type"] = "application/json";
    return fetch(path, Object.assign({}, options, {headers:headers})).then(function(response){
      return response.json().catch(function(){ return {}; }).then(function(body){
        if(!response.ok) throw new Error((body.error && body.error.message) || ("HTTP " + response.status));
        return body;
      });
    });
  }
  function showLogin(message){
    localStorage.removeItem("rann_token");
    token = "";
    app.classList.add("hidden");
    login.classList.remove("hidden");
    if(message){ var error = document.getElementById("loginError"); error.textContent = message; error.classList.remove("hidden"); }
  }
  function fmtDate(value){
    if(!value) return "-";
    var date = new Date(Number(value));
    return isNaN(date.getTime()) ? "-" : date.toLocaleString("id-ID", {dateStyle:"short", timeStyle:"short"});
  }
  function statusClass(value){
    if(["done","ok","active","healthy","ready","enabled"].indexOf(String(value)) >= 0) return "var(--ok)";
    if(["failed","error","dead","down","revoked"].indexOf(String(value)) >= 0) return "var(--bad)";
    if(["running","queued","degraded","stalled"].indexOf(String(value)) >= 0) return "var(--warn)";
    return "var(--muted)";
  }
  function table(rows, columns){
    if(!rows || rows.length === 0) return '<div class="empty">Belum ada data.</div>';
    var html = '<table><thead><tr>';
    for(var c=0;c<columns.length;c++) html += "<th>" + esc(columns[c].label) + "</th>";
    html += "</tr></thead><tbody>";
    for(var i=0;i<rows.length;i++){
      html += "<tr>";
      for(var j=0;j<columns.length;j++){
        var col = columns[j];
        var value = typeof col.value === "function" ? col.value(rows[i]) : rows[i][col.key];
        var text = col.format ? col.format(value, rows[i]) : esc(value);
        html += "<td>" + text + "</td>";
      }
      html += "</tr>";
    }
    return html + "</tbody></table>";
  }
  function metric(label, value, hint){
    return '<div class="metric"><span>' + esc(label) + '</span><b>' + esc(value) + '</b>' + (hint ? '<span>' + esc(hint) + '</span>' : '') + '</div>';
  }
  function page(title){
    currentPage = title;
    document.getElementById("title").textContent = title.charAt(0).toUpperCase() + title.slice(1);
    var links = document.querySelectorAll(".nav");
    for(var i=0;i<links.length;i++) links[i].classList.toggle("active", links[i].getAttribute("data-page") === title);
    document.getElementById("sidebar").classList.remove("open");
  }
  function load(pageName){
    page(pageName);
    if(pageName === "chat") return renderChat();
    view.innerHTML = '<div class="empty">Memuat...</div>';
    api("/v1/pages/" + encodeURIComponent(pageName)).then(function(data){
      if(pageName === "overview") return renderOverview(data);
      if(pageName === "gateway") return renderGateway(data);
      if(pageName === "settings") return renderSettings(data);
      if(pageName === "permissions") return renderPermissions(data);
      view.innerHTML = '<div class="panel">' + table(data.items || [], columnsFor(pageName)) + '</div>';
    }).catch(function(error){ view.innerHTML = '<div class="error">' + esc(error.message) + '</div>'; });
  }
  function columnsFor(page){
    if(page === "sessions") return [
      {key:"title",label:"Judul"},{key:"status",label:"Status",format:function(v){return '<span style="color:'+statusClass(v)+'">'+esc(v)+'</span>';}},
      {key:"model",label:"Model"},{key:"permission_mode",label:"Izin"},{key:"updated_at",label:"Diperbarui",format:fmtDate}
    ];
    if(page === "tasks") return [{key:"title",label:"Task"},{key:"status",label:"Status",format:function(v){return '<span style="color:'+statusClass(v)+'">'+esc(v)+'</span>';}},{key:"priority",label:"Prioritas"},{key:"updated_at",label:"Diperbarui",format:fmtDate}];
    if(page === "agents") return [{key:"name",label:"Agen"},{key:"role",label:"Peran"},{key:"status",label:"Status",format:function(v){return '<span style="color:'+statusClass(v)+'">'+esc(v)+'</span>';}},{key:"model",label:"Model"}];
    if(page === "plans") return [{key:"goal",label:"Goal"},{key:"status",label:"Status"},{key:"version",label:"Versi"},{key:"updated_at",label:"Diperbarui",format:fmtDate}];
    if(page === "models") return [{key:"id",label:"Model"},{key:"provider",label:"Provider"},{key:"contextWindow",label:"Context"},{key:"input_price",label:"Input $"},{key:"output_price",label:"Output $"}];
    if(page === "providers") return [{key:"name",label:"Provider"},{key:"kind",label:"Jenis"},{key:"base_url",label:"Base URL"},{key:"enabled",label:"Aktif",format:function(v){return v?"ya":"tidak";}}];
    if(page === "skills") return [{key:"name",label:"Skill"},{key:"description",label:"Deskripsi"},{key:"source",label:"Sumber"}];
    if(page === "memory") return [{key:"content",label:"Isi"},{key:"scope",label:"Scope"},{key:"importance",label:"Bobot"},{key:"created_at",label:"Dibuat",format:fmtDate}];
    if(page === "tools") return [{key:"name",label:"Tool"},{key:"category",label:"Kategori"},{key:"risk",label:"Risiko"},{key:"enabled",label:"Aktif",format:function(v){return v?"ya":"tidak";}}];
    if(page === "mcp") return [{key:"name",label:"Server"},{key:"command",label:"Command"},{key:"status",label:"Status"},{key:"enabled",label:"Aktif",format:function(v){return v?"ya":"tidak";}}];
    if(page === "plugins") return [{key:"name",label:"Plugin"},{key:"version",label:"Versi"},{key:"enabled",label:"Aktif",format:function(v){return v?"ya":"tidak";}},{key:"path",label:"Path"}];
    if(page === "scheduler") return [{key:"name",label:"Jadwal"},{key:"schedule",label:"Ekspresi"},{key:"timezone",label:"Zona"},{key:"next_run_at",label:"Berikutnya",format:fmtDate},{key:"enabled",label:"Aktif",format:function(v){return v?"ya":"tidak";}}];
    if(page === "logs") return [{key:"created_at",label:"Waktu",format:fmtDate},{key:"type",label:"Tipe"},{key:"session_id",label:"Sesi"},{key:"payload",label:"Payload",format:function(v){return '<span class="mono">'+esc(String(v||"").slice(0,180))+'</span>';}}];
    return [{key:"id",label:"ID"},{key:"status",label:"Status"},{key:"created_at",label:"Dibuat",format:fmtDate}];
  }
  function renderOverview(data){
    var counts = data.counts || {};
    view.innerHTML = '<div class="grid">' +
      metric("Sesi aktif", counts.sessions_active || 0, (counts.sessions || 0) + " total") +
      metric("Turn hari ini", counts.turns_today || 0, (counts.turns || 0) + " total") +
      metric("Task berjalan", counts.tasks_running || 0, (counts.tasks || 0) + " total") +
      metric("Biaya hari ini", "$" + Number(counts.cost_today || 0).toFixed(4), (counts.cost_total || 0).toFixed(4) + " total") +
      metric("Job antre", counts.jobs_queued || 0, (counts.jobs_running || 0) + " berjalan") +
      metric("Jadwal aktif", counts.schedulers_active || 0, (counts.schedulers || 0) + " total") +
      metric("Perangkat", counts.devices_active || 0, (counts.devices || 0) + " terdaftar") +
      metric("Audit", counts.audit || 0, "entri") +
      '</div><div class="panel"><h3 style="margin-top:0">Aktivitas terbaru</h3>' +
      table(data.recent || [], [{key:"type",label:"Event"},{key:"session_id",label:"Sesi"},{key:"created_at",label:"Waktu",format:fmtDate}]) + '</div>';
  }
  function renderGateway(data){
    var status = data.status || {};
    var stats = data.stats || {};
    view.innerHTML = '<div class="grid">' + metric("Status", status.running?"aktif":"mati") + metric("Host", status.host + ":" + status.port) + metric("Klien", status.clients) + metric("Perangkat", stats.active_devices || 0) + '</div>' +
      '<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Perangkat terdaftar</h3><button class="secondary" id="pairNew">Buat kode pairing</button></div><div id="pairBox" class="status" style="margin:10px 0"></div>' +
      table(data.devices || [], [{key:"name",label:"Nama"},{key:"role",label:"Role"},{key:"scopes",label:"Scope",format:function(v){return esc((v||[]).join(", "));}},{key:"last_seen_at",label:"Terakhir",format:fmtDate},{key:"revoked_at",label:"Dicabut",format:function(v){return v?"ya":"tidak";}}]) + '</div>';
    document.getElementById("pairNew").onclick = function(){
      api("/v1/gateway/pair",{method:"POST",body:"{}"}).then(function(body){
        document.getElementById("pairBox").textContent = body.code ? "Kode: " + body.code + " (berlaku " + Math.round((body.expires_in_ms||600000)/60000) + " menit)" : "Gagal membuat kode";
      }).catch(function(error){document.getElementById("pairBox").textContent = error.message;});
    };
  }
  function renderSettings(data){
    view.innerHTML = '<div class="panel"><h3 style="margin-top:0">Konfigurasi efektif</h3><pre class="mono" style="white-space:pre-wrap">' + esc(JSON.stringify(data.config || {}, null, 2)) + '</pre></div><div class="panel"><h3 style="margin-top:0">Berkas config</h3><div class="mono">' + esc((data.files || []).join("\\n")) + '</div></div>';
  }
  function renderPermissions(data){
    view.innerHTML = '<div class="grid">' + metric("Mode", data.mode || "-") + metric("Workspace only", data.workspace_only?"ya":"tidak") + metric("Allow", (data.allow||[]).length) + metric("Deny", (data.deny||[]).length) + '</div><div class="panel"><pre class="mono" style="white-space:pre-wrap">' + esc(JSON.stringify(data, null, 2)) + '</pre></div>';
  }
  function renderChat(){
    view.innerHTML = '<div class="chat"><div class="messages" id="messages"><div class="empty">Menyiapkan sesi...</div></div><div class="composer"><textarea id="prompt" placeholder="Tulis pesan, Enter untuk kirim"></textarea><input type="file" id="file" style="display:none"><button class="secondary" id="attach">Lampiran</button><button class="secondary" id="newSession">Sesi baru</button><button class="secondary" id="setModel">Ganti model</button><button class="secondary" id="cancel">Batalkan</button><button class="secondary" id="endSession">Akhiri sesi</button><button id="send">Kirim</button></div></div>';
    api("/v1/chat/ensure",{method:"POST",body:"{}"}).then(function(session){
      chatSession = session.id;
      return api("/v1/sessions/" + encodeURIComponent(chatSession));
    }).then(function(session){
      renderMessages(session.messages || []);
    }).catch(function(error){ document.getElementById("messages").innerHTML = '<div class="error">' + esc(error.message) + '</div>'; });
    var prompt = document.getElementById("prompt");
    prompt.addEventListener("keydown", function(event){ if(event.key === "Enter" && !event.shiftKey){ event.preventDefault(); sendMessage(); } });
    document.getElementById("send").onclick = sendMessage;
    document.getElementById("attach").onclick = function(){ document.getElementById("file").click(); };
    document.getElementById("newSession").onclick = function(){
      api("/v1/sessions",{method:"POST",body:JSON.stringify({title:"Web baru"})}).then(function(session){
        chatSession = session.id;
        renderChat();
      }).catch(function(error){alert(error.message);});
    };
    document.getElementById("setModel").onclick = function(){
      var next = prompt("Nama model, contoh mock-1", "");
      if(!next) return;
      api("/v1/sessions/"+encodeURIComponent(chatSession)+"/model",{method:"POST",body:JSON.stringify({model:next})})
        .then(function(){alert("Model diganti ke "+next);})
        .catch(function(error){alert(error.message);});
    };
    document.getElementById("endSession").onclick = function(){
      if(!confirm("Akhiri sesi ini?")) return;
      api("/v1/sessions/"+encodeURIComponent(chatSession)+"/end",{method:"POST",body:"{}"})
        .then(function(){chatSession=null;renderChat();})
        .catch(function(error){alert(error.message);});
    };
    document.getElementById("cancel").onclick = function(){
      if(!chatSession) return;
      api("/v1/sessions/" + encodeURIComponent(chatSession) + "/cancel",{method:"POST",body:"{}"}).then(function(){ document.getElementById("send").disabled=false; document.getElementById("send").textContent="Kirim"; });
    };
    document.getElementById("file").onchange = function(){
      var file = this.files && this.files[0];
      if(!file) return;
      var headers = {"content-type": file.type || "application/octet-stream", "x-filename": file.name};
      fetch("/v1/sessions/" + encodeURIComponent(chatSession) + "/attachments", {method:"POST",headers:headers,body:file})
        .then(function(r){ if(!r.ok) throw new Error("unggah gagal"); return r.json(); })
        .then(function(body){ pendingAttachment = {path: body.path, name: body.name}; document.getElementById("attach").textContent = "Lampiran: " + body.name; })
        .catch(function(error){ document.getElementById("attach").textContent = "Lampiran gagal"; });
    };
  }
  function renderMessages(messages){
    var box = document.getElementById("messages");
    if(!box) return;
    if(!messages.length){ box.innerHTML = '<div class="empty">Belum ada pesan.</div>'; return; }
    box.innerHTML = messages.map(function(message){
      var role = message.role === "tool" ? "tool" : (message.role === "user" ? "user" : "assistant");
      return '<div class="msg ' + role + '">' + esc(message.content) + '</div>';
    }).join("");
    box.scrollTop = box.scrollHeight;
  }
  function sendMessage(){
    var field = document.getElementById("prompt");
    var text = field.value.trim();
    if(!text || !chatSession) return;
    field.value = "";
    var box = document.getElementById("messages");
    if(box.querySelector(".empty")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", '<div class="msg user">' + esc(text) + '</div>');
    box.scrollTop = box.scrollHeight;
    var button = document.getElementById("send");
    button.disabled = true;
    button.textContent = "Mengirim...";
    var payload = {text:text};
    if(pendingAttachment){ payload.attachments = [pendingAttachment]; }
    api("/v1/sessions/" + encodeURIComponent(chatSession) + "/messages", {method:"POST",body:JSON.stringify(payload)}).then(function(turn){
      pendingAttachment = null;
      var attachButton = document.getElementById("attach");
      if(attachButton) attachButton.textContent = "Lampiran";
      button.textContent = "Berjalan...";
      var poll = setInterval(function(){
        api("/v1/turns/" + encodeURIComponent(turn.id || turn.turnId)).then(function(data){
          if(data.status === "running" || data.status === "queued") return;
          clearInterval(poll);
          button.disabled = false;
          button.textContent = "Kirim";
          api("/v1/sessions/" + encodeURIComponent(chatSession)).then(function(session){ renderMessages(session.messages || []); });
        }).catch(function(error){
          clearInterval(poll); button.disabled = false; button.textContent = "Kirim";
          box.insertAdjacentHTML("beforeend", '<div class="msg tool">' + esc(error.message) + '</div>');
        });
      }, 1200);
    }).catch(function(error){
      button.disabled = false; button.textContent = "Kirim";
      box.insertAdjacentHTML("beforeend", '<div class="msg tool">' + esc(error.message) + '</div>');
    });
  }
  function connectEvents(){
    if(socket) socket.close();
    var protocol = "rann_token." + token;
    socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/v1/events?since=0", [protocol]);
    socket.onmessage = function(message){
      var payload = JSON.parse(message.data);
      if(payload.type !== "event") return;
      var event = payload.event;
      if(event.type === "turn.end" && currentPage === "chat" && chatSession && event.sessionId === chatSession){
        api("/v1/sessions/" + encodeURIComponent(chatSession)).then(function(session){ renderMessages(session.messages || []); });
      }
      if(event.type === "approval.request"){
        var data = event.data || {};
        var box = document.getElementById("messages");
        if(box && currentPage === "chat"){
          box.insertAdjacentHTML("beforeend", '<div class="msg tool" id="approve-' + esc(data.request_id) + '">Izin diminta: ' + esc(data.tool) + ' <button data-approve="' + esc(data.request_id) + '">Izinkan</button> <button class="danger" data-deny="' + esc(data.request_id) + '">Tolak</button></div>');
          box.scrollTop = box.scrollHeight;
        }
      }
    };
    socket.onclose = function(){ setTimeout(connectEvents, 2000); };
  }
  document.addEventListener("click", function(event){
    var target = event.target;
    if(target && target.getAttribute && target.getAttribute("data-approve")){
      var id = target.getAttribute("data-approve");
      api("/v1/approvals/" + encodeURIComponent(id), {method:"POST",body:JSON.stringify({approved:true})});
    }
    if(target && target.getAttribute && target.getAttribute("data-deny")){
      var denyId = target.getAttribute("data-deny");
      api("/v1/approvals/" + encodeURIComponent(denyId), {method:"POST",body:JSON.stringify({approved:false})});
    }
  });
  document.getElementById("pair").onclick = function(){
    var code = document.getElementById("code").value.trim().toUpperCase();
    var name = document.getElementById("name").value.trim() || "web";
    fetch("/v1/auth/pair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:code,name:name})})
      .then(function(response){ return response.json().then(function(body){ if(!response.ok) throw new Error((body.error&&body.error.message)||"Pairing gagal"); return body; }); })
      .then(function(body){
        token = body.token; device = body.device;
        localStorage.setItem("rann_token", token);
        login.classList.add("hidden"); app.classList.remove("hidden");
        document.getElementById("deviceName").textContent = device.name;
        connectEvents(); load("overview");
      })
      .catch(function(error){ showLogin(error.message); });
  };
  document.getElementById("logout").onclick = function(){ showLogin(); };
  document.getElementById("menu").onclick = function(){ document.getElementById("sidebar").classList.toggle("open"); };
  var links = document.querySelectorAll(".nav");
  for(var i=0;i<links.length;i++) links[i].onclick = function(){ load(this.getAttribute("data-page")); };
  document.getElementById("version").textContent = "v${version}";
  setInterval(function(){ document.getElementById("clock").textContent = new Date().toLocaleTimeString("id-ID"); }, 1000);
  if(token){
    api("/v1/auth/me").then(function(body){
      device = body.device;
      login.classList.add("hidden"); app.classList.remove("hidden");
      document.getElementById("deviceName").textContent = device.name;
      connectEvents(); load("overview");
    }).catch(function(){ showLogin(); });
  }
})();
</script>
</body>
</html>`;
}
