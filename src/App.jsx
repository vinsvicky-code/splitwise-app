import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "firebase/auth";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, where, serverTimestamp
} from "firebase/firestore";

// ── Firebase Config ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDEqOHVkn0GQU8vxf-8b00JJgyUKrq59Oo",
  authDomain: "splitsaathi-1e6d7.firebaseapp.com",
  projectId: "splitsaathi-1e6d7",
  storageBucket: "splitsaathi-1e6d7.firebasestorage.app",
  messagingSenderId: "261680595042",
  appId: "1:261680595042:web:cb077cdd28fcf67a56513b"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const avatarTxt = (name) => name?.slice(0, 2).toUpperCase() || "??";
const COLORS = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF922B","#CC5DE8","#20C997","#F06595","#74C0FC","#A9E34B"];
const memberColor = (name, members) => COLORS[members.findIndex(m => m.name === name) % COLORS.length] || "#4D96FF";
const today = () => new Date().toISOString().slice(0, 10);

const ROLES = {
  owner:  { label: "Owner",   icon: "👑", canEdit: true,  canDelete: true,  canManageMembers: true  },
  admin:  { label: "Admin",   icon: "🛡️", canEdit: true,  canDelete: true,  canManageMembers: true  },
  editor: { label: "Editor",  icon: "✏️", canEdit: true,  canDelete: false, canManageMembers: false },
  viewer: { label: "Viewer",  icon: "👁️", canEdit: false, canDelete: false, canManageMembers: false },
};

const CATEGORIES = [
  { id: "food",          label: "Food",          icon: "🍔" },
  { id: "travel",        label: "Travel",         icon: "✈️" },
  { id: "stay",          label: "Stay",           icon: "🏨" },
  { id: "fuel",          label: "Fuel",           icon: "⛽" },
  { id: "shopping",      label: "Shopping",       icon: "🛍️" },
  { id: "entertainment", label: "Fun",            icon: "🎬" },
  { id: "utilities",     label: "Utilities",      icon: "💡" },
  { id: "other",         label: "Other",          icon: "📦" },
];

// ── Balance Logic ─────────────────────────────────────────────────────────────
function computeBalances(members, expenses, advances) {
  const bal = {};
  members.forEach(m => bal[m.name] = 0);
  expenses.forEach(exp => {
    if (!exp.splitAmong?.length) return;
    const per = exp.amount / exp.splitAmong.length;
    exp.splitAmong.forEach(name => { if (name !== exp.paidBy) bal[name] = (bal[name]||0) - per; });
    const others = exp.splitAmong.filter(n => n !== exp.paidBy).length * per;
    bal[exp.paidBy] = (bal[exp.paidBy]||0) + others;
  });
  (advances||[]).forEach(adv => {
    bal[adv.from] = (bal[adv.from]||0) + adv.amount;
    bal[adv.to]   = (bal[adv.to]  ||0) - adv.amount;
  });
  return bal;
}

function computeSettlements(balances) {
  const d = [], c = [];
  Object.entries(balances).forEach(([name, amt]) => {
    if (amt < -0.01) d.push({ name, amt: +amt });
    if (amt >  0.01) c.push({ name, amt: +amt });
  });
  const settlements = [];
  let i = 0, j = 0;
  while (i < d.length && j < c.length) {
    const pay = Math.min(-d[i].amt, c[j].amt);
    settlements.push({ from: d[i].name, to: c[j].name, amount: pay });
    d[i].amt += pay; c[j].amt -= pay;
    if (Math.abs(d[i].amt) < 0.01) i++;
    if (Math.abs(c[j].amt) < 0.01) j++;
  }
  return settlements;
}

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Avatar({ name, photo, size = 36, members = [] }) {
  const color = memberColor(name, members);
  if (photo) return <img src={photo} alt={name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `2px solid ${color}`, flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color+"33", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size*0.34, fontWeight: 700, color, flexShrink: 0 }}>
      {avatarTxt(name)}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(10,12,20,0.88)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(6px)" }} onClick={onClose}>
      <div style={{ background:"#13172a", border:"1px solid #2a3060", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <span style={{ fontSize:16, fontWeight:700, color:"#f0f4ff" }}>{title}</span>
          <button onClick={onClose} style={{ background:"#1e2442", border:"none", borderRadius:8, width:32, height:32, color:"#6a7aaa", fontSize:16, cursor:"pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TInput({ label, ...props }) {
  return (
    <div style={{ marginBottom:15 }}>
      {label && <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>{label}</div>}
      <input {...props} style={{ width:"100%", background:"#0d1124", border:"1px solid #2a3060", borderRadius:10, padding:"10px 13px", color:"#f0f4ff", fontSize:13, outline:"none", fontFamily:"Poppins,sans-serif", boxSizing:"border-box", ...props.style }} />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:15 }}>
      <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function Pill({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: active?(color||"#4D96FF"):"#1e2442", border: active?"none":"1px solid #2a3060", borderRadius:8, padding:"5px 12px", color: active?"#fff":"#6a7aaa", fontSize:12, cursor:"pointer", fontFamily:"Poppins,sans-serif", fontWeight: active?700:400, transition:"all 0.15s" }}>
      {children}
    </button>
  );
}

function BigBtn({ children, onClick, grad="linear-gradient(135deg,#4D96FF,#6C63FF)", disabled=false }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width:"100%", background: disabled?"#1e2442":grad, border:"none", borderRadius:12, padding:"13px", color: disabled?"#3a4470":"#fff", fontSize:14, cursor: disabled?"not-allowed":"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif", opacity: disabled?0.6:1 }}>
      {children}
    </button>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function SplitApp() {
  const [user,         setUser]         = useState(null);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [groups,       setGroups]       = useState([]);
  const [activeGid,    setActiveGid]    = useState(null);
  const [myRoles,      setMyRoles]      = useState({});   // { groupId: role }
  const [expenses,     setExpenses]     = useState([]);
  const [advances,     setAdvances]     = useState([]);
  const [gMembers,     setGMembers]     = useState([]);   // { name, email, uid, photo, role }
  const [settledTxns,  setSettledTxns]  = useState([]);
  const [tab,          setTab]          = useState("expenses");
  const [toast,        setToast]        = useState(null);
  const [loading,      setLoading]      = useState(false);

  // modals
  const [showAddExpense,  setShowAddExpense]  = useState(false);
  const [showAddAdvance,  setShowAddAdvance]  = useState(false);
  const [showAddGroup,    setShowAddGroup]    = useState(false);
  const [showShare,       setShowShare]       = useState(false);
  const [showMembers,     setShowMembers]     = useState(false);

  // forms
  const [expForm, setExpForm] = useState({});
  const [advForm, setAdvForm] = useState({});
  const [newGroup, setNewGroup] = useState("");
  const [shareRole, setShareRole] = useState("editor");
  const [shareLink, setShareLink] = useState("");

  const activeGroup = groups.find(g => g.id === activeGid);
  const myRole      = myRoles[activeGid] || "viewer";
  const can         = ROLES[myRole] || ROLES.viewer;
  const balances    = computeBalances(gMembers, expenses, advances);
  const settlements = computeSettlements(balances);
  const totalSpent  = expenses.reduce((s,e)=>s+e.amount,0);
  const totalAdv    = advances.reduce((s,a)=>s+a.amount,0);

  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),2800); };

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setUser(u);
      setAuthLoading(false);
      if (u) await ensureUserDoc(u);
    });
  }, []);

  async function ensureUserDoc(u) {
    const ref = doc(db, "users", u.uid);
    await setDoc(ref, { name: u.displayName, email: u.email, photo: u.photoURL, uid: u.uid }, { merge: true });
  }

  async function loginGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch(e) { showToast("Login failed: " + e.message, "error"); }
  }

  async function logout() {
    await signOut(auth);
    setGroups([]); setActiveGid(null); setExpenses([]); setAdvances([]); setGMembers([]);
  }

  // ── Load Groups ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    // listen to groups where user is a member
    const q = query(collection(db, "groups"), where(`members.${user.uid}.uid`, "==", user.uid));
    const unsub = onSnapshot(q, snap => {
      const gs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setGroups(gs);
      const roles = {};
      gs.forEach(g => { roles[g.id] = g.members?.[user.uid]?.role || "viewer"; });
      setMyRoles(roles);
      if (gs.length > 0 && !activeGid) setActiveGid(gs[0].id);
    });
    return unsub;
  }, [user]);

  // ── Load Active Group Data ────────────────────────────────────────────────
  useEffect(() => {
    if (!activeGid) return;
    // expenses
    const unsubExp = onSnapshot(collection(db,"groups",activeGid,"expenses"), snap => {
      setExpenses(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.createdAt?.seconds-a.createdAt?.seconds));
    });
    // advances
    const unsubAdv = onSnapshot(collection(db,"groups",activeGid,"advances"), snap => {
      setAdvances(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    // members
    const unsubGrp = onSnapshot(doc(db,"groups",activeGid), snap => {
      if (snap.exists()) {
        const data = snap.data();
        const mList = Object.values(data.members||{});
        setGMembers(mList);
        setSettledTxns(data.settledTxns||[]);
      }
    });
    return () => { unsubExp(); unsubAdv(); unsubGrp(); };
  }, [activeGid]);

  // ── Check invite link ─────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteGid  = params.get("join");
    const inviteRole = params.get("role") || "viewer";
    if (inviteGid && user) joinGroup(inviteGid, inviteRole);
  }, [user]);

  async function joinGroup(gid, role) {
    const gref = doc(db,"groups",gid);
    const snap = await getDoc(gref);
    if (!snap.exists()) { showToast("Group not found!", "error"); return; }
    const data = snap.data();
    if (data.members?.[user.uid]) { showToast("You're already in this group!"); return; }
    await updateDoc(gref, {
      [`members.${user.uid}`]: { uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL, role }
    });
    setActiveGid(gid);
    window.history.replaceState({}, "", window.location.pathname);
    showToast(`Joined "${data.name}" as ${role}! 🎉`);
  }

  // ── Group Actions ─────────────────────────────────────────────────────────
  async function createGroup() {
    if (!newGroup.trim()) return;
    setLoading(true);
    try {
      const ref = await addDoc(collection(db,"groups"), {
        name: newGroup.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        members: {
          [user.uid]: { uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL, role: "owner" }
        },
        settledTxns: []
      });
      setActiveGid(ref.id);
      setNewGroup(""); setShowAddGroup(false);
      showToast(`"${newGroup.trim()}" created! 🎉`);
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setLoading(false);
  }

  // ── Expense Actions ───────────────────────────────────────────────────────
  function openAddExpense() {
    setExpForm({ description:"", amount:"", paidBy: user.displayName, category:"food", date: today(), splitAmong: gMembers.map(m=>m.name) });
    setShowAddExpense(true);
  }

  async function addExpense() {
    if (!expForm.description||!expForm.amount||!expForm.paidBy||!expForm.splitAmong?.length)
      return showToast("Fill all required fields!","error");
    setLoading(true);
    try {
      await addDoc(collection(db,"groups",activeGid,"expenses"), {
        ...expForm, amount: parseFloat(expForm.amount),
        addedBy: user.uid, createdAt: serverTimestamp()
      });
      setShowAddExpense(false); showToast(`"${expForm.description}" added!`);
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setLoading(false);
  }

  async function deleteExpense(id) {
    await deleteDoc(doc(db,"groups",activeGid,"expenses",id));
    showToast("Expense removed","warn");
  }

  // ── Advance Actions ───────────────────────────────────────────────────────
  function openAddAdvance() {
    const others = gMembers.filter(m=>m.name!==user.displayName);
    setAdvForm({ from: user.displayName, to: others[0]?.name||"", amount:"", note:"", date: today() });
    setShowAddAdvance(true);
  }

  async function addAdvance() {
    if (!advForm.from||!advForm.to||!advForm.amount) return showToast("Fill all fields!","error");
    if (advForm.from===advForm.to) return showToast("From and To can't be same!","error");
    setLoading(true);
    try {
      await addDoc(collection(db,"groups",activeGid,"advances"), {
        ...advForm, amount: parseFloat(advForm.amount),
        addedBy: user.uid, createdAt: serverTimestamp()
      });
      setShowAddAdvance(false); showToast(`Advance of ${fmt(parseFloat(advForm.amount))} recorded!`);
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setLoading(false);
  }

  async function deleteAdvance(id) {
    await deleteDoc(doc(db,"groups",activeGid,"advances",id));
    showToast("Advance removed","warn");
  }

  // ── Share / Invite ────────────────────────────────────────────────────────
  function generateShareLink(role) {
    const base = window.location.origin + window.location.pathname;
    const link = `${base}?join=${activeGid}&role=${role}`;
    setShareLink(link);
    setShareRole(role);
  }

  function copyLink() {
    navigator.clipboard.writeText(shareLink).then(()=>showToast("Link copied! 📋")).catch(()=>showToast("Copy failed","error"));
  }

  // ── Role Management ───────────────────────────────────────────────────────
  async function changeRole(memberUid, newRole) {
    if (memberUid === user.uid) return showToast("Can't change your own role!","error");
    await updateDoc(doc(db,"groups",activeGid), { [`members.${memberUid}.role`]: newRole });
    showToast("Role updated ✓");
  }

  async function removeMember(memberUid) {
    if (memberUid === user.uid) return showToast("Can't remove yourself!","error");
    const updated = { ...activeGroup.members };
    delete updated[memberUid];
    await updateDoc(doc(db,"groups",activeGid), { members: updated });
    showToast("Member removed","warn");
  }

  // ── Settle ────────────────────────────────────────────────────────────────
  async function markSettled(txn) {
    const key = txn.from+"->"+txn.to;
    const updated = [...settledTxns, key];
    await updateDoc(doc(db,"groups",activeGid), { settledTxns: updated });
    showToast(`${txn.from} → ${txn.to} settled ✓`);
  }

  const toggleSplit = (name) => setExpForm(p=>({...p, splitAmong: p.splitAmong?.includes(name)?p.splitAmong.filter(n=>n!==name):[...(p.splitAmong||[]),name]}));

  // ── Login Screen ──────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ minHeight:"100vh", background:"#0a0c16", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:"#4D96FF", fontSize:14, fontFamily:"Poppins,sans-serif" }}>Loading...</div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:"#0a0c16", fontFamily:"Poppins,sans-serif", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24 }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ width:70, height:70, borderRadius:20, background:"linear-gradient(135deg,#FF6B6B,#FFD93D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, marginBottom:20 }}>✂</div>
      <div style={{ fontSize:28, fontWeight:800, color:"#f0f4ff", marginBottom:8 }}>SplitSaathi</div>
      <div style={{ fontSize:13, color:"#6a7aaa", marginBottom:48, textAlign:"center", lineHeight:1.7 }}>Split expenses with friends & family.<br/>Sign in to get started!</div>
      <button onClick={loginGoogle} style={{ display:"flex", alignItems:"center", gap:12, background:"#fff", border:"none", borderRadius:14, padding:"14px 28px", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif", boxShadow:"0 6px 24px rgba(0,0,0,0.3)", color:"#1a1a2e" }}>
        <img src="https://www.google.com/favicon.ico" width={20} height={20} alt="G" />
        Continue with Google
      </button>
    </div>
  );

  // ── Main App ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#0a0c16", fontFamily:"Poppins,sans-serif", color:"#f0f4ff", maxWidth:480, margin:"0 auto", paddingBottom:90 }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:9999, background: toast.type==="error"?"#ff4757ee":toast.type==="warn"?"#ffa502ee":"#2ed573ee", borderRadius:12, padding:"10px 22px", fontSize:13, color:"#fff", fontWeight:600, boxShadow:"0 8px 24px rgba(0,0,0,0.4)", whiteSpace:"nowrap", animation:"slideDown 0.3s ease" }}>
          {toast.type==="success"?"✓ ":toast.type==="error"?"✗ ":"⚠ "}{toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#1a1f3a,#0f1226)", padding:"16px 16px 0", borderBottom:"1px solid #1e2442" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#FF6B6B,#FFD93D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>✂</div>
            <div>
              <div style={{ fontSize:16, fontWeight:800 }}>SplitSaathi</div>
              <div style={{ fontSize:9, color:"#6a7aaa", letterSpacing:1 }}>EXPENSE SPLITTER</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {activeGid && can.canManageMembers && (
              <button onClick={()=>{ generateShareLink(shareRole); setShowShare(true); }} style={{ background:"#1e2442", border:"1px solid #2a3060", borderRadius:8, padding:"6px 12px", color:"#4D96FF", fontSize:11, cursor:"pointer", fontWeight:600 }}>🔗 Share</button>
            )}
            <button onClick={()=>setShowAddGroup(true)} style={{ background:"#1e2442", border:"1px solid #2a3060", borderRadius:8, padding:"6px 12px", color:"#FFD93D", fontSize:11, cursor:"pointer", fontWeight:600 }}>+ Group</button>
            <div onClick={logout} style={{ cursor:"pointer" }}>
              {user.photoURL
                ? <img src={user.photoURL} width={32} height={32} style={{ borderRadius:"50%", border:"2px solid #2a3060" }} alt="me" />
                : <div style={{ width:32, height:32, borderRadius:"50%", background:"#4D96FF33", border:"2px solid #4D96FF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#4D96FF" }}>{avatarTxt(user.displayName)}</div>
              }
            </div>
          </div>
        </div>

        {/* Group Tabs */}
        {groups.length > 0 && (
          <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:1 }}>
            {groups.map(g => (
              <button key={g.id} onClick={()=>{ setActiveGid(g.id); setTab("expenses"); }} style={{ background: activeGid===g.id?"#4D96FF":"transparent", border: activeGid===g.id?"none":"1px solid #2a3060", borderRadius:"8px 8px 0 0", padding:"7px 14px", color: activeGid===g.id?"#fff":"#6a7aaa", fontSize:11, cursor:"pointer", whiteSpace:"nowrap", fontWeight: activeGid===g.id?700:400, fontFamily:"Poppins,sans-serif" }}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No groups */}
      {groups.length === 0 && (
        <div style={{ textAlign:"center", padding:"60px 24px" }}>
          <div style={{ fontSize:60, marginBottom:16 }}>✂️</div>
          <div style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>Welcome, {user.displayName?.split(" ")[0]}!</div>
          <div style={{ fontSize:13, color:"#6a7aaa", marginBottom:32, lineHeight:1.7 }}>Create a group or join one via an invite link from a friend!</div>
          <button onClick={()=>setShowAddGroup(true)} style={{ background:"linear-gradient(135deg,#FF6B6B,#FF922B)", border:"none", borderRadius:14, padding:"14px 32px", color:"#fff", fontSize:15, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif", boxShadow:"0 6px 20px #FF6B6B44" }}>+ Create First Group</button>
        </div>
      )}

      {/* Stats */}
      {activeGid && (
        <>
          <div style={{ background:"#0f1226", padding:"10px 14px", display:"flex", gap:8, borderBottom:"1px solid #1e2442" }}>
            {[
              { label:"Spent",   value: fmt(totalSpent), color:"#f0f4ff" },
              { label:"Advances",value: fmt(totalAdv),   color:"#FFD93D" },
              { label:"Members", value: gMembers.length, color:"#4D96FF" },
              { label:"My Role", value: ROLES[myRole]?.icon+" "+ROLES[myRole]?.label, color:"#CC5DE8" },
            ].map((s,i)=>(
              <div key={i} style={{ flex:1, background:"#13172a", borderRadius:10, padding:"8px 6px", textAlign:"center" }}>
                <div style={{ fontSize:12, fontWeight:700, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:9, color:"#6a7aaa", marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Nav */}
          <div style={{ display:"flex", background:"#0f1226", borderBottom:"1px solid #1e2442" }}>
            {[
              { id:"expenses", label:"Expenses", icon:"📋" },
              { id:"advances", label:"Advances", icon:"💰" },
              { id:"balances", label:"Balances", icon:"⚖️" },
              { id:"settle",   label:"Settle",   icon:"💸" },
              { id:"members",  label:"Members",  icon:"👥" },
            ].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, background:"transparent", border:"none", borderBottom: tab===t.id?"2px solid #4D96FF":"2px solid transparent", padding:"10px 2px", color: tab===t.id?"#4D96FF":"#6a7aaa", fontSize:9, cursor:"pointer", fontWeight: tab===t.id?700:400, fontFamily:"Poppins,sans-serif", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                <span style={{ fontSize:13 }}>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>

          <div style={{ padding:14 }}>

            {/* EXPENSES */}
            {tab==="expenses" && (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <span style={{ fontSize:12, color:"#6a7aaa" }}>{expenses.length} expense{expenses.length!==1?"s":""}</span>
                  {can.canEdit && <button onClick={openAddExpense} style={{ background:"linear-gradient(135deg,#4D96FF,#6C63FF)", border:"none", borderRadius:10, padding:"8px 16px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>+ Add</button>}
                </div>
                {expenses.length===0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0", color:"#3a4470" }}>
                    <div style={{ fontSize:44, marginBottom:10 }}>🧾</div>
                    <div style={{ fontSize:14, fontWeight:600 }}>No expenses yet</div>
                    {!can.canEdit && <div style={{ fontSize:11, marginTop:6, color:"#6a7aaa" }}>You have view-only access</div>}
                  </div>
                ) : expenses.map(exp => {
                  const cat = CATEGORIES.find(c=>c.id===exp.category);
                  return (
                    <div key={exp.id} style={{ background:"#13172a", border:"1px solid #1e2442", borderRadius:14, padding:"12px 14px", marginBottom:8, display:"flex", gap:10 }}>
                      <div style={{ width:38, height:38, borderRadius:10, background:"#1e2442", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{cat?.icon||"📦"}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", justifyContent:"space-between" }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700 }}>{exp.description}</div>
                            <div style={{ fontSize:10, color:"#6a7aaa", marginTop:1 }}>{exp.date} · <span style={{ color: memberColor(exp.paidBy, gMembers) }}>{exp.paidBy}</span></div>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0 }}>
                            <div style={{ fontSize:14, fontWeight:800, color:"#FFD93D" }}>{fmt(exp.amount)}</div>
                            <div style={{ fontSize:9, color:"#6a7aaa" }}>{fmt(exp.amount/(exp.splitAmong?.length||1))}/person</div>
                          </div>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:7 }}>
                          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                            {(exp.splitAmong||[]).map(name=>(
                              <span key={name} style={{ background: memberColor(name,gMembers)+"22", border:`1px solid ${memberColor(name,gMembers)}44`, borderRadius:5, padding:"1px 6px", fontSize:9, color: memberColor(name,gMembers), fontWeight:600 }}>{name}</span>
                            ))}
                          </div>
                          {can.canDelete && <button onClick={()=>deleteExpense(exp.id)} style={{ background:"#ff475722", border:"none", borderRadius:5, padding:"2px 8px", color:"#ff4757", fontSize:10, cursor:"pointer", flexShrink:0 }}>✕</button>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ADVANCES */}
            {tab==="advances" && (
              <div>
                <div style={{ background:"#1a2a1a", border:"1px solid #2ed57344", borderRadius:12, padding:"10px 14px", marginBottom:14, display:"flex", gap:8 }}>
                  <span style={{ fontSize:18 }}>💡</span>
                  <div style={{ fontSize:11, color:"#a0e0b0", lineHeight:1.7 }}>Record money given <b>before</b> a trip. Automatically adjusts final balances.</div>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <span style={{ fontSize:12, color:"#6a7aaa" }}>{advances.length} advance{advances.length!==1?"s":""} · {fmt(totalAdv)}</span>
                  {can.canEdit && <button onClick={openAddAdvance} style={{ background:"linear-gradient(135deg,#FFD93D,#FF922B)", border:"none", borderRadius:10, padding:"8px 16px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>+ Add</button>}
                </div>
                {advances.length===0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0", color:"#3a4470" }}>
                    <div style={{ fontSize:44, marginBottom:10 }}>💰</div>
                    <div style={{ fontSize:14, fontWeight:600 }}>No advances recorded</div>
                  </div>
                ) : advances.map(adv=>(
                  <div key={adv.id} style={{ background:"#13172a", border:"1px solid #FFD93D33", borderRadius:14, padding:"12px 14px", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                      <div style={{ width:36,height:36,borderRadius:10,background:"#FFD93D22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>💰</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{adv.note||"Advance Payment"}</div>
                        <div style={{ fontSize:10, color:"#6a7aaa" }}>{adv.date}</div>
                      </div>
                      <div style={{ fontSize:15, fontWeight:800, color:"#FFD93D" }}>{fmt(adv.amount)}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
                        <Avatar name={adv.from} members={gMembers} size={24} />
                        <span style={{ color:memberColor(adv.from,gMembers), fontWeight:700 }}>{adv.from}</span>
                        <span style={{ color:"#4D96FF" }}>→</span>
                        <Avatar name={adv.to} members={gMembers} size={24} />
                        <span style={{ color:memberColor(adv.to,gMembers), fontWeight:700 }}>{adv.to}</span>
                      </div>
                      {can.canDelete && <button onClick={()=>deleteAdvance(adv.id)} style={{ background:"#ff475722", border:"none", borderRadius:5, padding:"2px 8px", color:"#ff4757", fontSize:10, cursor:"pointer" }}>✕</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* BALANCES */}
            {tab==="balances" && (
              <div>
                <div style={{ fontSize:11, color:"#3a4470", marginBottom:12, background:"#13172a", borderRadius:10, padding:"9px 12px" }}>
                  ⚖️ Includes expenses + advances · Green = gets back · Red = owes
                </div>
                {gMembers.map(m=>{
                  const bal = balances[m.name]||0;
                  const isOwed=bal>0.01, owes=bal<-0.01;
                  return (
                    <div key={m.uid||m.name} style={{ background:"#13172a", border:`1px solid ${isOwed?"#2ed57344":owes?"#ff475744":"#1e2442"}`, borderRadius:14, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                      <Avatar name={m.name} photo={m.photo} members={gMembers} size={40} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{m.name}{m.uid===user.uid?" (you)":""}</div>
                        <div style={{ fontSize:10, color:"#6a7aaa", marginTop:1 }}>{isOwed?"gets back":owes?"owes":"all settled ✓"}</div>
                      </div>
                      <div style={{ fontSize:16, fontWeight:800, color: isOwed?"#2ed573":owes?"#ff4757":"#6a7aaa" }}>
                        {isOwed?"+":owes?"-":""}{Math.abs(bal)>0.01?fmt(bal):"₹0"}
                      </div>
                    </div>
                  );
                })}
                {totalSpent > 0 && <>
                  <div style={{ marginTop:14, marginBottom:8, fontSize:12, color:"#6a7aaa" }}>By category</div>
                  {CATEGORIES.map(cat=>{
                    const total = expenses.filter(e=>e.category===cat.id).reduce((s,e)=>s+e.amount,0);
                    if (!total) return null;
                    return (
                      <div key={cat.id} style={{ marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                          <span style={{ fontSize:11 }}>{cat.icon} {cat.label}</span>
                          <span style={{ fontSize:11, fontWeight:700, color:"#FFD93D" }}>{fmt(total)}</span>
                        </div>
                        <div style={{ background:"#1e2442", borderRadius:4, height:5 }}>
                          <div style={{ width:((total/totalSpent)*100)+"%", background:"linear-gradient(90deg,#4D96FF,#6C63FF)", borderRadius:4, height:"100%" }} />
                        </div>
                      </div>
                    );
                  })}
                </>}
              </div>
            )}

            {/* SETTLE */}
            {tab==="settle" && (
              <div>
                <div style={{ fontSize:11, color:"#3a4470", marginBottom:12, background:"#13172a", borderRadius:10, padding:"9px 12px" }}>
                  💸 Minimum transactions · Advances & expenses included
                </div>
                {settlements.length===0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0" }}>
                    <div style={{ fontSize:44, marginBottom:10 }}>🎉</div>
                    <div style={{ fontSize:15, fontWeight:600, color:"#2ed573" }}>All settled up!</div>
                  </div>
                ) : settlements.map((s,i)=>{
                  const key=s.from+"->"+s.to, done=settledTxns.includes(key);
                  return (
                    <div key={i} style={{ background:"#13172a", border:`1px solid ${done?"#2ed57344":"#2a3060"}`, borderRadius:14, padding:14, marginBottom:8, opacity:done?0.5:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                        <Avatar name={s.from} members={gMembers} size={36} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, color:"#6a7aaa" }}>needs to pay</div>
                          <div style={{ fontSize:18, fontWeight:800, color:"#FF6B6B" }}>{fmt(s.amount)}</div>
                        </div>
                        <div style={{ fontSize:20, color:"#4D96FF" }}>→</div>
                        <Avatar name={s.to} members={gMembers} size={36} />
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontSize:12 }}>
                          <span style={{ color:memberColor(s.from,gMembers), fontWeight:700 }}>{s.from}</span>
                          <span style={{ color:"#6a7aaa" }}> pays </span>
                          <span style={{ color:memberColor(s.to,gMembers), fontWeight:700 }}>{s.to}</span>
                        </div>
                        {!done
                          ? <button onClick={()=>markSettled(s)} style={{ background:"linear-gradient(135deg,#2ed573,#1abc9c)", border:"none", borderRadius:8, padding:"6px 14px", color:"#fff", fontSize:11, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>Settled ✓</button>
                          : <span style={{ fontSize:11, color:"#2ed573", fontWeight:700 }}>✓ Done</span>
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* MEMBERS */}
            {tab==="members" && (
              <div>
                {can.canManageMembers && (
                  <div style={{ background:"#13172a", border:"1px solid #2a3060", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"#6a7aaa", marginBottom:8 }}>🔗 INVITE VIA LINK — Choose access level:</div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                      {Object.entries(ROLES).filter(([k])=>k!=="owner").map(([k,v])=>(
                        <Pill key={k} active={shareRole===k} color={k==="admin"?"#CC5DE8":k==="editor"?"#4D96FF":"#6a7aaa"} onClick={()=>{ setShareRole(k); generateShareLink(k); }}>
                          {v.icon} {v.label}
                        </Pill>
                      ))}
                    </div>
                    {shareLink && (
                      <div style={{ display:"flex", gap:6 }}>
                        <div style={{ flex:1, background:"#0d1124", border:"1px solid #2a3060", borderRadius:8, padding:"8px 10px", fontSize:10, color:"#6a7aaa", wordBreak:"break-all" }}>{shareLink}</div>
                        <button onClick={copyLink} style={{ background:"#4D96FF", border:"none", borderRadius:8, padding:"0 14px", color:"#fff", fontSize:11, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif", flexShrink:0 }}>Copy</button>
                      </div>
                    )}
                    {!shareLink && <button onClick={()=>generateShareLink(shareRole)} style={{ background:"linear-gradient(135deg,#4D96FF,#6C63FF)", border:"none", borderRadius:8, padding:"9px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif", width:"100%" }}>Generate Invite Link 🔗</button>}
                  </div>
                )}
                {gMembers.map(m=>{
                  const role = ROLES[m.role]||ROLES.viewer;
                  return (
                    <div key={m.uid||m.name} style={{ background:"#13172a", border:"1px solid #1e2442", borderRadius:14, padding:"12px 14px", marginBottom:8, display:"flex", gap:10, alignItems:"center" }}>
                      <Avatar name={m.name} photo={m.photo} members={gMembers} size={44} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{m.name}{m.uid===user.uid?" (you)":""}</div>
                        <div style={{ fontSize:10, color:"#6a7aaa", marginTop:1 }}>{m.email}</div>
                        <div style={{ marginTop:5, display:"flex", gap:4 }}>
                          {can.canManageMembers && m.uid!==user.uid && Object.entries(ROLES).filter(([k])=>k!=="owner").map(([k,v])=>(
                            <button key={k} onClick={()=>changeRole(m.uid,k)} style={{ background: m.role===k?(k==="admin"?"#CC5DE8":k==="editor"?"#4D96FF":"#6a7aaa")+"33":"#1e2442", border:`1px solid ${m.role===k?(k==="admin"?"#CC5DE8":k==="editor"?"#4D96FF":"#6a7aaa"):"#2a3060"}`, borderRadius:6, padding:"2px 8px", color: m.role===k?(k==="admin"?"#CC5DE8":k==="editor"?"#4D96FF":"#aaa"):"#6a7aaa", fontSize:10, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>{v.icon} {v.label}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                        <span style={{ fontSize:11, fontWeight:700, color: m.role==="owner"?"#FFD93D":m.role==="admin"?"#CC5DE8":m.role==="editor"?"#4D96FF":"#6a7aaa" }}>{role.icon} {role.label}</span>
                        {can.canManageMembers && m.uid!==user.uid && (
                          <button onClick={()=>removeMember(m.uid)} style={{ background:"#ff475722", border:"none", borderRadius:5, padding:"2px 8px", color:"#ff4757", fontSize:10, cursor:"pointer" }}>Remove</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* FABs */}
      {activeGid && can.canEdit && tab==="expenses" && (
        <button onClick={openAddExpense} style={{ position:"fixed", bottom:24, right:24, width:52, height:52, borderRadius:"50%", background:"linear-gradient(135deg,#4D96FF,#6C63FF)", border:"none", color:"#fff", fontSize:26, cursor:"pointer", boxShadow:"0 6px 20px #4D96FF66", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>+</button>
      )}
      {activeGid && can.canEdit && tab==="advances" && (
        <button onClick={openAddAdvance} style={{ position:"fixed", bottom:24, right:24, width:52, height:52, borderRadius:"50%", background:"linear-gradient(135deg,#FFD93D,#FF922B)", border:"none", color:"#fff", fontSize:26, cursor:"pointer", boxShadow:"0 6px 20px #FFD93D66", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>+</button>
      )}

      {/* ADD EXPENSE MODAL */}
      {showAddExpense && (
        <Modal title="➕ Add Expense" onClose={()=>setShowAddExpense(false)}>
          <TInput label="Description *" placeholder="e.g. Hotel booking" value={expForm.description||""} onChange={e=>setExpForm(p=>({...p,description:e.target.value}))} />
          <TInput label="Amount (₹) *" type="number" placeholder="0.00" value={expForm.amount||""} onChange={e=>setExpForm(p=>({...p,amount:e.target.value}))} />
          <Field label="Category">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {CATEGORIES.map(c=><Pill key={c.id} active={expForm.category===c.id} onClick={()=>setExpForm(p=>({...p,category:c.id}))}>{c.icon} {c.label}</Pill>)}
            </div>
          </Field>
          <Field label="Paid By *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {gMembers.map(m=><Pill key={m.uid||m.name} active={expForm.paidBy===m.name} color={memberColor(m.name,gMembers)} onClick={()=>setExpForm(p=>({...p,paidBy:m.name}))}>{m.name}</Pill>)}
            </div>
          </Field>
          <Field label="Split Among *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {gMembers.map(m=>(
                <button key={m.uid||m.name} onClick={()=>toggleSplit(m.name)} style={{ background: expForm.splitAmong?.includes(m.name)?memberColor(m.name,gMembers)+"44":"#1e2442", border:`1px solid ${expForm.splitAmong?.includes(m.name)?memberColor(m.name,gMembers):"#2a3060"}`, borderRadius:8, padding:"5px 11px", color: expForm.splitAmong?.includes(m.name)?memberColor(m.name,gMembers):"#6a7aaa", fontSize:11, cursor:"pointer", fontFamily:"Poppins,sans-serif", fontWeight:600 }}>
                  {expForm.splitAmong?.includes(m.name)?"✓ ":""}{m.name}
                </button>
              ))}
            </div>
            {expForm.splitAmong?.length>0 && expForm.amount && (
              <div style={{ marginTop:7, fontSize:11, color:"#FFD93D", fontWeight:600 }}>
                {fmt(parseFloat(expForm.amount||0)/expForm.splitAmong.length)} per person
              </div>
            )}
          </Field>
          <TInput label="Date" type="date" value={expForm.date||today()} onChange={e=>setExpForm(p=>({...p,date:e.target.value}))} />
          <BigBtn onClick={addExpense} disabled={loading}>{loading?"Saving...":"Add Expense"}</BigBtn>
        </Modal>
      )}

      {/* ADD ADVANCE MODAL */}
      {showAddAdvance && (
        <Modal title="💰 Record Advance" onClose={()=>setShowAddAdvance(false)}>
          <div style={{ background:"#1a2a1a", border:"1px solid #2ed57333", borderRadius:10, padding:"10px 12px", marginBottom:14, fontSize:11, color:"#a0e0b0", lineHeight:1.6 }}>
            Record money received before actual expense. Reduces their share in final settlement.
          </div>
          <Field label="Who Gave? *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {gMembers.map(m=><Pill key={m.uid||m.name} active={advForm.from===m.name} color={memberColor(m.name,gMembers)} onClick={()=>setAdvForm(p=>({...p,from:m.name}))}>{m.name}</Pill>)}
            </div>
          </Field>
          <Field label="Who Received? *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {gMembers.map(m=><Pill key={m.uid||m.name} active={advForm.to===m.name} color={memberColor(m.name,gMembers)} onClick={()=>setAdvForm(p=>({...p,to:m.name}))}>{m.name}</Pill>)}
            </div>
          </Field>
          <TInput label="Amount (₹) *" type="number" placeholder="0.00" value={advForm.amount||""} onChange={e=>setAdvForm(p=>({...p,amount:e.target.value}))} />
          <TInput label="Note (optional)" placeholder="e.g. For hotel booking" value={advForm.note||""} onChange={e=>setAdvForm(p=>({...p,note:e.target.value}))} />
          <TInput label="Date" type="date" value={advForm.date||today()} onChange={e=>setAdvForm(p=>({...p,date:e.target.value}))} />
          {advForm.from && advForm.to && advForm.amount && advForm.from!==advForm.to && (
            <div style={{ background:"#1e2442", borderRadius:10, padding:"9px 12px", marginBottom:12, fontSize:12, color:"#c0d0ff", textAlign:"center" }}>
              <span style={{ color:memberColor(advForm.from,gMembers), fontWeight:700 }}>{advForm.from}</span>
              <span style={{ color:"#6a7aaa" }}> gave </span>
              <span style={{ color:"#FFD93D", fontWeight:700 }}>{fmt(parseFloat(advForm.amount||0))}</span>
              <span style={{ color:"#6a7aaa" }}> to </span>
              <span style={{ color:memberColor(advForm.to,gMembers), fontWeight:700 }}>{advForm.to}</span>
            </div>
          )}
          <BigBtn onClick={addAdvance} grad="linear-gradient(135deg,#FFD93D,#FF922B)" disabled={loading}>{loading?"Saving...":"Record Advance 💰"}</BigBtn>
        </Modal>
      )}

      {/* ADD GROUP MODAL */}
      {showAddGroup && (
        <Modal title="🗂 New Group" onClose={()=>setShowAddGroup(false)}>
          <TInput label="Group Name" placeholder="e.g. Goa Trip 🏖️" value={newGroup} onChange={e=>setNewGroup(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createGroup()} />
          <BigBtn onClick={createGroup} grad="linear-gradient(135deg,#FF6B6B,#FF922B)" disabled={loading}>{loading?"Creating...":"Create Group 🚀"}</BigBtn>
        </Modal>
      )}

      <div style={{ textAlign:"center", padding:"16px 0 6px", color:"#1e2442", fontSize:10 }}>
        ☁️ Data synced to cloud · Tap your photo to sign out
      </div>

      <style>{`
        @keyframes slideDown { from { opacity:0; transform:translateX(-50%) translateY(-10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
        * { -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width:3px; } ::-webkit-scrollbar-thumb { background:#1e2442; border-radius:2px; }
      `}</style>
    </div>
  );
}
