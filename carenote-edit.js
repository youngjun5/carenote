/* 케어노트 산하 정적 문서 — 공용 "직접 수정" 시스템
   사용법:
     1) <html data-page-id="page-무언가"> 로 문서마다 고유 id 지정
     2) 편집 가능하게 할 요소마다 data-ek="고유키" 부여
     3) <script src=".../supabase-js@2.58.0/dist/umd/supabase.js"></script> 다음에 이 파일을 로드
     4) 페이지 자체의 인터랙션 초기화 코드는 window에서
        addEventListener('carenote:content-ready', fn) 로 감싸서 실행
        (저장된 수정 내용이 반영된 *이후*에 체크리스트 등이 올바른 요소를 잡도록 하기 위함)

   저장 위치: 기존 케어노트가 쓰는 Supabase `boards` 테이블을 그대로 재사용.
   (id = data-page-id, content.fields = {ek키: innerHTML}) — 관리자 비밀문구(x-admin-key)는
   케어노트 보드와 완전히 동일 ("carenote:adminkey" localStorage, 같은 오리진이라 공유됨). */
(function () {
  var SB_URL = "https://mgvqhrdhshpuamihfvnp.supabase.co";
  var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndnFocmRoc2hwdWFtaWhmdm5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MTE4NjQsImV4cCI6MjEwNDE4Nzg2NH0.fjDJuG-47YHU63lydUSZGAGg3FQ-DLGLp9ufnJ4SN30";
  var ADMIN_LS = "carenote:adminkey";
  var PAGE_ID = document.documentElement.getAttribute("data-page-id");

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  var fired = false;
  function fireReady() {
    if (fired) return;
    fired = true;
    window.dispatchEvent(new CustomEvent("carenote:content-ready"));
  }
  // 네트워크가 막혀도 페이지 자체 기능은 살아있어야 하니 안전장치로 강제 발화
  setTimeout(fireReady, 4000);

  injectStyle();

  ready(function () {
    if (!PAGE_ID) { fireReady(); return; }
    if (!window.supabase || !window.supabase.createClient) { fireReady(); return; }

    var read = window.supabase.createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
    var adminKey = null;
    try { adminKey = localStorage.getItem(ADMIN_LS); } catch (e) {}
    var isAdmin = !!adminKey;
    var admin = isAdmin ? window.supabase.createClient(SB_URL, SB_ANON, {
      auth: { persistSession: false },
      global: { headers: { "x-admin-key": adminKey } }
    }) : null;

    var zones = Array.prototype.slice.call(document.querySelectorAll("[data-ek]"));
    var myRev = 0;

    function applyFields(fields) {
      if (!fields) return;
      zones.forEach(function (z) {
        var k = z.getAttribute("data-ek");
        if (Object.prototype.hasOwnProperty.call(fields, k)) z.innerHTML = fields[k];
      });
    }

    function fetchRow() {
      return read.from("boards").select("content,rev").eq("id", PAGE_ID).single();
    }

    fetchRow().then(function (r) {
      var row = r.data;
      myRev = row ? (row.rev || 0) : 0;
      if (row && row.content && row.content.fields) applyFields(row.content.fields);
      fireReady();
      mountUI();
      subscribe();
    }).catch(function () {
      fireReady();
      mountUI();
      subscribe();
    });

    function mountUI() {
      var wrap = document.createElement("div");
      wrap.id = "ceBar";
      var editBtn = document.createElement("button");
      editBtn.id = "ceEditBtn";
      editBtn.type = "button";
      editBtn.textContent = "편집";
      var saveBtn = document.createElement("button");
      saveBtn.id = "ceSaveBtn";
      saveBtn.type = "button";
      saveBtn.textContent = "저장";
      saveBtn.hidden = true;
      wrap.appendChild(editBtn);
      wrap.appendChild(saveBtn);
      document.body.appendChild(wrap);

      var editing = false;

      function promptKey() {
        var k = window.prompt("관리자 비밀문구를 입력하세요 (편집하려면):", "");
        if (k == null) return;
        k = k.trim(); if (!k) return;
        try { localStorage.setItem(ADMIN_LS, k); } catch (e) {}
        location.reload();
      }

      function setEditing(v) {
        editing = v;
        zones.forEach(function (z) {
          z.contentEditable = v ? "true" : "false";
          z.classList.toggle("ce-zone-on", v);
        });
        editBtn.textContent = v ? "편집 종료" : "편집 계속";
        saveBtn.hidden = !v;
      }

      if (isAdmin) {
        zones.forEach(function (z) { z.classList.add("ce-zone"); });
        editBtn.addEventListener("click", function () { setEditing(!editing); });
        saveBtn.addEventListener("click", saveNow);
      } else {
        editBtn.addEventListener("click", promptKey);
      }

      // 저장 전, 화면에만 붙는 임시 UI 조각(삭제 버튼 등)과 "체크됨" 상태는
      // 공용 기본값에 섞여 들어가지 않도록 정리한다.
      function cleanHTML(zone) {
        var clone = zone.cloneNode(true);
        clone.querySelectorAll("[data-ce-ignore]").forEach(function (n) { n.remove(); });
        clone.querySelectorAll(".done").forEach(function (n) { n.classList.remove("done"); });
        return clone.innerHTML;
      }

      function saveNow() {
        var fields = {};
        zones.forEach(function (z) { fields[z.getAttribute("data-ek")] = cleanHTML(z); });
        var nextRev = myRev + 1;
        saveBtn.textContent = "저장 중…";
        admin.from("boards").upsert({
          id: PAGE_ID,
          title: document.title,
          content: { fields: fields, rev: nextRev },
          rev: nextRev,
          updated_at: new Date().toISOString()
        }).then(function (r) {
          if (r.error) throw r.error;
          myRev = nextRev;
          saveBtn.textContent = "저장됨 ✓";
          setTimeout(function () { saveBtn.textContent = "저장"; }, 1600);
        }).catch(function (err) {
          console.warn("[ce] save error", err);
          var s = String((err && (err.message || err.code || err.error)) || err);
          if (/row-level|permission|policy|42501|401|403/i.test(s)) {
            alert("비밀문구가 틀렸습니다. 다시 입력해주세요.");
            try { localStorage.removeItem(ADMIN_LS); } catch (e) {}
            location.reload();
          } else {
            saveBtn.textContent = "저장 실패 — 다시 시도";
          }
        });
      }
    }

    function subscribe() {
      try {
        read.channel("ce-" + PAGE_ID)
          .on("postgres_changes", { event: "*", schema: "public", table: "boards", filter: "id=eq." + PAGE_ID }, function () {
            fetchRow().then(function (r) {
              var row = r.data;
              if (!row || (row.rev || 0) <= myRev) return;
              myRev = row.rev || 0;
              if (row.content && row.content.fields) applyFields(row.content.fields);
            }).catch(function () {});
          })
          .subscribe();
      } catch (e) {}
    }
  });

  function injectStyle() {
    var s = document.createElement("style");
    s.textContent =
      "#ceBar{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      "#ceEditBtn,#ceSaveBtn{border:none;border-radius:999px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px -6px rgba(0,0,0,.45);}" +
      "#ceEditBtn{background:#26241c;color:#f2ede0;}" +
      "#ceSaveBtn{background:#33507c;color:#fff;}" +
      "#ceEditBtn:hover,#ceSaveBtn:hover{filter:brightness(1.12);}" +
      ".ce-zone{outline:1px dashed transparent;border-radius:3px;transition:outline-color .15s;}" +
      ".ce-zone-on{outline:2px dashed #33507c;outline-offset:3px;background:rgba(51,80,124,0.06);cursor:text;}";
    document.head.appendChild(s);
  }
})();
