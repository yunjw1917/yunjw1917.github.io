const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
const ADMIN_PASSWORD = "CHANGE_THIS_PASSWORD";

const AUTH_KEY = "club-admin-auth-v1";
let supabaseClient = null;

function getSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase 라이브러리가 로드되지 않았습니다.");
  }
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes("YOUR_SUPABASE_URL") ||
    SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")
  ) {
    throw new Error("common.js의 SUPABASE_URL / SUPABASE_ANON_KEY를 설정해 주세요.");
  }
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === "1";
}

function loginWithPassword(password) {
  if (password === ADMIN_PASSWORD) {
    localStorage.setItem(AUTH_KEY, "1");
    return true;
  }
  return false;
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = "./index.html";
}

function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = "./index.html";
    return false;
  }
  return true;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR");
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setStatus(message, type) {
  const el = document.getElementById("page-status");
  if (!el) return;
  el.textContent = message || "";
  el.className = `status ${type || ""}`.trim();
}

async function fetchAllBackupData() {
  const sb = getSupabase();
  const [membersRes, attendanceRes, evalRes] = await Promise.all([
    sb.from("members").select("*").order("id", { ascending: true }),
    sb.from("attendance").select("*").order("id", { ascending: true }),
    sb.from("evaluations").select("*").order("id", { ascending: true })
  ]);
  if (membersRes.error) throw membersRes.error;
  if (attendanceRes.error) throw attendanceRes.error;
  if (evalRes.error) throw evalRes.error;
  return {
    exported_at: new Date().toISOString(),
    version: 1,
    members: membersRes.data || [],
    attendance: attendanceRes.data || [],
    evaluations: evalRes.data || []
  };
}

async function exportBackupToPc() {
  setStatus("백업 데이터를 준비하는 중입니다...");
  const data = await fetchAllBackupData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `club-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("PC에 백업 JSON 파일을 저장했습니다.", "ok");
}

function parseBackupJson(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("백업 파일 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed.members) || !Array.isArray(parsed.attendance) || !Array.isArray(parsed.evaluations)) {
    throw new Error("백업 파일에 필요한 배열(members, attendance, evaluations)이 없습니다.");
  }
  return parsed;
}

function pickMemberRow(m) {
  const row = {
    id: toInt(m.id),
    name: String(m.name || "").trim(),
    team_no: toInt(m.team_no),
    role: m.role === "leader" ? "leader" : "member",
    note: m.note ? String(m.note) : null
  };
  if (m.created_at) row.created_at = m.created_at;
  if (m.updated_at) row.updated_at = m.updated_at;
  return row;
}

function pickAttendanceRow(a) {
  const row = {
    id: toInt(a.id),
    member_id: toInt(a.member_id),
    date: String(a.date || ""),
    status: ["present", "late", "absent"].includes(a.status) ? a.status : "present"
  };
  if (a.created_at) row.created_at = a.created_at;
  if (a.updated_at) row.updated_at = a.updated_at;
  return row;
}

function pickEvaluationRow(e) {
  const row = {
    id: toInt(e.id),
    member_id: toInt(e.member_id),
    team_no: toInt(e.team_no),
    hour_slot: String(e.hour_slot || "").trim(),
    content: String(e.content || "").trim()
  };
  if (e.created_at) row.created_at = e.created_at;
  return row;
}

async function importBackupFromPc(file) {
  if (!file) return;
  setStatus("백업 파일을 읽는 중입니다...");
  const text = await file.text();
  const parsed = parseBackupJson(text);
  const members = parsed.members.map(pickMemberRow).filter((m) => m.id && m.name && m.team_no);
  const attendance = parsed.attendance
    .map(pickAttendanceRow)
    .filter((a) => a.id && a.member_id && a.date && a.status);
  const evaluations = parsed.evaluations
    .map(pickEvaluationRow)
    .filter((e) => e.id && e.member_id && e.team_no && e.hour_slot && e.content);

  const sb = getSupabase();
  setStatus("서버 데이터를 백업 파일 내용으로 덮어쓰는 중입니다...");

  const delAttendance = await sb.from("attendance").delete().gte("id", 0);
  if (delAttendance.error) throw delAttendance.error;
  const delEvaluations = await sb.from("evaluations").delete().gte("id", 0);
  if (delEvaluations.error) throw delEvaluations.error;
  const delMembers = await sb.from("members").delete().gte("id", 0);
  if (delMembers.error) throw delMembers.error;

  if (members.length) {
    const insMembers = await sb.from("members").upsert(members, { onConflict: "id" });
    if (insMembers.error) throw insMembers.error;
  }
  if (attendance.length) {
    const insAttendance = await sb.from("attendance").upsert(attendance, { onConflict: "id" });
    if (insAttendance.error) throw insAttendance.error;
  }
  if (evaluations.length) {
    const insEvaluations = await sb.from("evaluations").upsert(evaluations, { onConflict: "id" });
    if (insEvaluations.error) throw insEvaluations.error;
  }

  setStatus("PC 백업 불러오기를 완료했습니다. 화면을 새로고침합니다.", "ok");
  setTimeout(() => window.location.reload(), 800);
}

function setupGnb(activePage) {
  const root = document.getElementById("gnb-root");
  if (!root) return;

  root.innerHTML = `
    <div class="gnb-wrap">
      <div class="gnb">
        <a href="./index.html" data-page="main">메인</a>
        <a href="./attendance.html" data-page="attendance">출석 관리</a>
        <a href="./evaluations.html" data-page="evaluations">자기평가</a>
        <a href="./members.html" data-page="members">인원 관리</a>
        <button type="button" id="btn-export">💾 PC에 저장</button>
        <button type="button" id="btn-import">📂 PC에서 불러오기</button>
        <input type="file" id="backup-file" accept=".json,application/json" hidden>
        <button type="button" class="split" id="btn-logout">로그아웃</button>
      </div>
    </div>
  `;

  root.querySelectorAll("a[data-page]").forEach((a) => {
    if (a.dataset.page === activePage) a.classList.add("active-link");
  });

  document.getElementById("btn-export").addEventListener("click", async () => {
    try {
      await exportBackupToPc();
    } catch (err) {
      setStatus(err.message || "PC 저장 중 오류가 발생했습니다.", "error");
    }
  });

  const fileInput = document.getElementById("backup-file");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (event) => {
    try {
      const file = event.target.files && event.target.files[0];
      await importBackupFromPc(file);
    } catch (err) {
      setStatus(err.message || "PC 백업 불러오기 중 오류가 발생했습니다.", "error");
    } finally {
      fileInput.value = "";
    }
  });

  document.getElementById("btn-logout").addEventListener("click", logout);
}

async function getMembers() {
  const sb = getSupabase();
  const res = await sb.from("members").select("*").order("team_no", { ascending: true }).order("name", { ascending: true });
  if (res.error) throw res.error;
  return res.data || [];
}

async function addMember(payload) {
  const sb = getSupabase();
  const res = await sb.from("members").insert(payload).select("*").single();
  if (res.error) throw res.error;
  return res.data;
}

async function updateMember(id, payload) {
  const sb = getSupabase();
  const res = await sb
    .from("members")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw res.error;
  return res.data;
}

async function removeMember(id) {
  const sb = getSupabase();
  const res = await sb.from("members").delete().eq("id", id);
  if (res.error) throw res.error;
}

async function getAttendanceByDate(date) {
  const sb = getSupabase();
  const res = await sb.from("attendance").select("*").eq("date", date);
  if (res.error) throw res.error;
  return res.data || [];
}

async function saveAttendance(memberId, date, status) {
  const sb = getSupabase();
  const payload = {
    member_id: memberId,
    date,
    status,
    updated_at: new Date().toISOString()
  };
  const res = await sb.from("attendance").upsert(payload, { onConflict: "member_id,date" }).select("*").single();
  if (res.error) throw res.error;
  return res.data;
}

async function getEvaluations() {
  const sb = getSupabase();
  const res = await sb
    .from("evaluations")
    .select("*, members(name)")
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  return res.data || [];
}

async function addEvaluation(payload) {
  const sb = getSupabase();
  const res = await sb.from("evaluations").insert(payload).select("*").single();
  if (res.error) throw res.error;
  return res.data;
}

async function getMemberDetail(memberId) {
  const sb = getSupabase();
  const [memberRes, attendanceRes, evalRes] = await Promise.all([
    sb.from("members").select("*").eq("id", memberId).single(),
    sb.from("attendance").select("*").eq("member_id", memberId).order("date", { ascending: false }),
    sb.from("evaluations").select("*").eq("member_id", memberId).order("created_at", { ascending: false })
  ]);
  if (memberRes.error) throw memberRes.error;
  if (attendanceRes.error) throw attendanceRes.error;
  if (evalRes.error) throw evalRes.error;
  return {
    member: memberRes.data,
    attendance: attendanceRes.data || [],
    evaluations: evalRes.data || []
  };
}

window.ClubApp = {
  ADMIN_PASSWORD,
  addEvaluation,
  addMember,
  formatDateTime,
  getAttendanceByDate,
  getEvaluations,
  getMemberDetail,
  getMembers,
  isAuthenticated,
  loginWithPassword,
  logout,
  removeMember,
  requireAuth,
  saveAttendance,
  setStatus,
  setupGnb,
  updateMember
};
