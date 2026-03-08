import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut, onAuthStateChanged, updateProfile
} from "firebase/auth";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, updateDoc,
  deleteDoc, getDocs, onSnapshot, query, where, serverTimestamp
} from "firebase/firestore";

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_API_KEY            || "",
  authDomain:        import.meta.env.VITE_AUTH_DOMAIN        || "splitsaathi-1e6d7.firebaseapp.com",
  projectId:         import.meta.env.VITE_PROJECT_ID         || "splitsaathi-1e6d7",
  storageBucket:     import.meta.env.VITE_STORAGE_BUCKET     || "splitsaathi-1e6d7.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID|| "261680595042",
  appId:             import.meta.env.VITE_APP_ID             || "1:261680595042:web:cb077cdd28fcf67a56513b"
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const fmt  = (n) => "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const avTx = (name) => name?.slice(0, 2).toUpperCase() || "??";
const today = () => new Date().toISOString().slice(0, 10);
const COLORS = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF922B","#CC5DE8","#20C997","#F06595","#74C0FC","#A9E34B"];
const mColor = (name, members) => COLORS[members.findIndex(m => m.name === name) % COLORS.length] || "#4D96FF";

// ── Local Storage (guest mode) ────────────────────────────────────────────────
const LS_KEY = "splitsaathi_guest_v1";
const lsLoad = () => { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const lsSave = (d) => { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} };

// ── Roles ─────────────────────────────────────────────────────────────────────
const ROLES = {
  owner:  { label:"Owner",  icon:"👑", canEdit:true,  canDelete:true,  canManage:true  },
  admin:  { label:"Admin",  icon:"🛡️", canEdit:true,  canDelete:true,  canManage:true  },
  editor: { label:"Editor", icon:"✏️", canEdit:true,  canDelete:false, canManage:false },
  viewer: { label:"Viewer", icon:"👁️", canEdit:false, canDelete:false, canManage:false },
};

const CATEGORIES = [
  { id:"food",          label:"Food",          icon:"🍔" },
  { id:"travel",        label:"Travel",        icon:"✈️" },
  { id:"stay",          label:"Stay",          icon:"🏨" },
  { id:"fuel",          label:"Fuel",          icon:"⛽" },
  { id:"shopping",      label:"Shopping",      icon:"🛍️" },
  { id:"entertainment", label:"Fun",           icon:"🎬" },
  { id:"utilities",     label:"Utilities",     icon:"💡" },
  { id:"other",         label:"Other",         icon:"📦" },
];

// ── Balance Logic ─────────────────────────────────────────────────────────────
function computeBalances(members, expenses, advances) {
  const bal = {};
  members.forEach(m => bal[m.name] = 0);
  expenses.forEach(exp => {
    if (!exp.splitAmong?.length) return;
    // unequal split: customAmounts = { name: amount }
    if (exp.splitMode === "unequal" && exp.customAmounts) {
      Object.entries(exp.customAmounts).forEach(([name, amt]) => {
        if (name !== exp.paidBy) bal[name] = (bal[name]||0) - amt;
      });
      const othersTotal = Object.entries(exp.customAmounts)
        .filter(([n]) => n !== exp.paidBy)
        .reduce((s,[,a]) => s + a, 0);
      bal[exp.paidBy] = (bal[exp.paidBy]||0) + othersTotal;
    } else {
      const per = exp.amount / exp.splitAmong.length;
      exp.splitAmong.forEach(n => { if (n !== exp.paidBy) bal[n] = (bal[n]||0) - per; });
      bal[exp.paidBy] = (bal[exp.paidBy]||0) + exp.splitAmong.filter(n => n !== exp.paidBy).length * per;
    }
  });
  (advances||[]).forEach(a => {
    bal[a.from] = (bal[a.from]||0) + a.amount;
    bal[a.to]   = (bal[a.to]  ||0) - a.amount;
  });
  return bal;
}

function computeSettlements(balances) {
  const d = [], c = [];
  Object.entries(balances).forEach(([name, amt]) => {
    if (amt < -0.01) d.push({ name, amt: +amt });
    if (amt >  0.01) c.push({ name, amt: +amt });
  });
  const out = []; let i = 0, j = 0;
  while (i < d.length && j < c.length) {
    const pay = Math.min(-d[i].amt, c[j].amt);
    out.push({ from: d[i].name, to: c[j].name, amount: pay });
    d[i].amt += pay; c[j].amt -= pay;
    if (Math.abs(d[i].amt) < 0.01) i++;
    if (Math.abs(c[j].amt) < 0.01) j++;
  }
  return out;
}

// ── UI Atoms ──────────────────────────────────────────────────────────────────
function Av({ name, photo, size = 36, members = [] }) {
  const color = mColor(name, members);
  if (photo) return <img src={photo} alt={name} style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", border:`2px solid ${color}`, flexShrink:0 }} />;
  return <div style={{ width:size, height:size, borderRadius:"50%", background:color+"33", border:`2px solid ${color}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.34, fontWeight:700, color, flexShrink:0 }}>{avTx(name)}</div>;
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(10,12,20,0.9)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(6px)" }} onClick={onClose}>
      <div style={{ background:"#13172a", border:"1px solid #2a3060", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }} onClick={e => e.stopPropagation()}>
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
    <div style={{ marginBottom:14 }}>
      {label && <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>{label}</div>}
      <input {...props} style={{ width:"100%", background:"#0d1124", border:"1px solid #2a3060", borderRadius:10, padding:"11px 13px", color:"#f0f4ff", fontSize:13, outline:"none", fontFamily:"Poppins,sans-serif", boxSizing:"border-box", ...props.style }} />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function Pill({ active, color, onClick, children }) {
  return <button onClick={onClick} style={{ background:active?(color||"#4D96FF"):"#1e2442", border:active?"none":"1px solid #2a3060", borderRadius:8, padding:"5px 12px", color:active?"#fff":"#6a7aaa", fontSize:12, cursor:"pointer", fontFamily:"Poppins,sans-serif", fontWeight:active?700:400 }}>{children}</button>;
}

function BigBtn({ children, onClick, grad = "linear-gradient(135deg,#4D96FF,#6C63FF)", disabled = false }) {
  return <button onClick={onClick} disabled={disabled} style={{ width:"100%", background:disabled?"#1e2442":grad, border:"none", borderRadius:12, padding:"13px", color:disabled?"#3a4470":"#fff", fontSize:14, cursor:disabled?"not-allowed":"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>{children}</button>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function SplitApp() {
  // Auth
  const [user,        setUser]        = useState(null);   // null = not logged in
  const [isGuest,     setIsGuest]     = useState(false);  // true = guest mode
  const [authLoading, setAuthLoading] = useState(true);
  const [authTab,     setAuthTab]     = useState("magic"); // "magic"|"password"
  const [authForm,    setAuthForm]    = useState({ name:"", email:"", password:"" });
  const [magicEmail,  setMagicEmail]  = useState("");
  const [magicSent,   setMagicSent]   = useState(false);
  const [authError,   setAuthError]   = useState("");
  const [authLoading2,setAuthLoading2]= useState(false);

  // App state
  const [groups,      setGroups]      = useState([]);
  const [activeGid,   setActiveGid]   = useState(null);
  const [myRoles,     setMyRoles]     = useState({});
  const [expenses,    setExpenses]    = useState([]);
  const [advances,    setAdvances]    = useState([]);
  const [gMembers,    setGMembers]    = useState([]);
  const [settledTxns, setSettledTxns] = useState([]);
  const [tab,         setTab]         = useState("expenses");
  const [toast,       setToast]       = useState(null);
  const [loading,     setLoading]     = useState(false);

  // Modals
  const [showExp,      setShowExp]      = useState(false);
  const [showAdv,      setShowAdv]      = useState(false);
  const [showGroup,    setShowGroup]    = useState(false);
  const [editingExp,   setEditingExp]   = useState(null); // expense being edited
  const [editingAdv,   setEditingAdv]   = useState(null); // advance being edited

  // Forms
  const [expForm,   setExpForm]   = useState({});
  const [advForm,   setAdvForm]   = useState({});
  const [newGroup,  setNewGroup]  = useState("");
  const [shareRole, setShareRole] = useState("editor");
  const [shareLink, setShareLink] = useState("");

  const activeGroup = groups.find(g => g.id === activeGid);
  const myRole      = myRoles[activeGid] || (isGuest ? "owner" : "viewer");
  const can         = ROLES[myRole] || ROLES.viewer;
  const members     = isGuest ? gMembers : gMembers;
  const balances    = computeBalances(gMembers, expenses, advances);
  const settlements = computeSettlements(balances);
  const totalSpent  = expenses.reduce((s, e) => s + e.amount, 0);
  const totalAdv    = advances.reduce((s, a) => s + a.amount, 0);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  // ── Firebase Auth Listener ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        setIsGuest(false);
        await setDoc(doc(db, "users", u.uid), { name: u.displayName||u.email, email: u.email, photo: u.photoURL||null, uid: u.uid }, { merge: true });
      }
    });
    return unsub;
  }, []);

  // ── Handle Magic Link on Page Load ───────────────────────────────────────
  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = localStorage.getItem("emailForSignIn") || window.prompt("Enter your email to confirm:");
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(async result => {
            localStorage.removeItem("emailForSignIn");
            window.history.replaceState({}, "", window.location.pathname);
            await setDoc(doc(db,"users",result.user.uid), { name: result.user.displayName||email, email, photo:null, uid: result.user.uid }, { merge: true });
            showToast("Signed in! Welcome 🎉");
          })
          .catch(e => setAuthError("Link error: " + e.message));
      }
    }
  }, []);

  // ── Guest Mode (localStorage) ─────────────────────────────────────────────
  function enterGuest() {
    setIsGuest(true);
    setAuthLoading(false);
    const saved = lsLoad();
    if (saved?.groups) {
      setGroups(saved.groups);
      if (saved.groups.length > 0) setActiveGid(saved.groups[0].id);
    }
  }

  // Auto-save guest data
  useEffect(() => {
    if (!isGuest) return;
    lsSave({ groups });
  }, [groups, isGuest]);

  // Load guest group data when activeGid changes
  useEffect(() => {
    if (!isGuest || !activeGid) return;
    const group = groups.find(g => g.id === activeGid);
    if (group) {
      setGMembers(group.members || []);
      setExpenses(group.expenses || []);
      setAdvances(group.advances || []);
      setSettledTxns(group.settledTxns || []);
    }
  }, [activeGid, isGuest, groups]);

  // ── Firebase Auth Functions ───────────────────────────────────────────────
  async function sendMagicLink() {
    setAuthError("");
    if (!magicEmail.trim()) return setAuthError("Please enter your email");
    setAuthLoading2(true);
    try {
      await sendSignInLinkToEmail(auth, magicEmail, {
        url: window.location.href,
        handleCodeInApp: true,
      });
      localStorage.setItem("emailForSignIn", magicEmail);
      setMagicSent(true);
      showToast("Magic link sent! Check your inbox 📧");
    } catch(e) {
      setAuthError(
        e.code === "auth/invalid-email" ? "Invalid email address."
        : e.code === "auth/too-many-requests" ? "Too many requests. Try later."
        : "Error: " + e.message
      );
    }
    setAuthLoading2(false);
  }

  async function register() {
    setAuthError("");
    if (!authForm.name.trim()) return setAuthError("Please enter your name");
    if (!authForm.email.trim()) return setAuthError("Please enter your email");
    if (authForm.password.length < 6) return setAuthError("Password must be 6+ characters");
    setAuthLoading2(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, authForm.email, authForm.password);
      await updateProfile(cred.user, { displayName: authForm.name.trim() });
      await setDoc(doc(db,"users",cred.user.uid), { name: authForm.name.trim(), email: authForm.email, photo:null, uid: cred.user.uid }, { merge:true });
      showToast("Welcome " + authForm.name + "! 🎉");
    } catch(e) {
      setAuthError(
        e.code === "auth/email-already-in-use" ? "Email already registered! Login instead."
        : e.code === "auth/invalid-email" ? "Invalid email."
        : "Error: " + e.message
      );
    }
    setAuthLoading2(false);
  }

  async function login() {
    setAuthError("");
    if (!authForm.email.trim()) return setAuthError("Please enter your email");
    if (!authForm.password) return setAuthError("Please enter your password");
    setAuthLoading2(true);
    try {
      await signInWithEmailAndPassword(auth, authForm.email, authForm.password);
      showToast("Welcome back! 🎉");
    } catch(e) {
      setAuthError(
        e.code === "auth/invalid-credential" ? "Wrong email or password."
        : e.code === "auth/user-not-found" ? "No account found. Register first."
        : e.code === "auth/too-many-requests" ? "Too many attempts. Try later."
        : "Error: " + e.message
      );
    }
    setAuthLoading2(false);
  }

  async function logout() {
    if (isGuest) { setIsGuest(false); setGroups([]); setActiveGid(null); return; }
    await signOut(auth);
    setGroups([]); setActiveGid(null); setExpenses([]); setAdvances([]); setGMembers([]);
  }

  // ── Firebase Group Loading ────────────────────────────────────────────────
  useEffect(() => {
    if (!user || isGuest) return;
    const q = query(collection(db,"groups"), where(`members.${user.uid}.uid`, "==", user.uid));
    const unsub = onSnapshot(q, snap => {
      const gs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setGroups(gs);
      const roles = {};
      gs.forEach(g => { roles[g.id] = g.members?.[user.uid]?.role || "viewer"; });
      setMyRoles(roles);
      if (gs.length > 0 && !activeGid) setActiveGid(gs[0].id);
    });
    return unsub;
  }, [user, isGuest]);

  useEffect(() => {
    if (!activeGid || isGuest) return;
    const u1 = onSnapshot(collection(db,"groups",activeGid,"expenses"), snap => {
      setExpenses(snap.docs.map(d => ({ id:d.id,...d.data() })).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)));
    });
    const u2 = onSnapshot(collection(db,"groups",activeGid,"advances"), snap => {
      setAdvances(snap.docs.map(d => ({ id:d.id,...d.data() })));
    });
    const u3 = onSnapshot(doc(db,"groups",activeGid), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setGMembers(Object.values(data.members||{}));
        setSettledTxns(data.settledTxns||[]);
      }
    });
    return () => { u1(); u2(); u3(); };
  }, [activeGid, isGuest]);

  // ── Invite Link ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || isGuest) return;
    const params = new URLSearchParams(window.location.search);
    const invGid = params.get("join"), invRole = params.get("role")||"viewer";
    if (invGid) joinGroup(invGid, invRole);
  }, [user]);

  async function joinGroup(gid, role) {
    const snap = await getDoc(doc(db,"groups",gid));
    if (!snap.exists()) return showToast("Group not found!", "error");
    const data = snap.data();
    if (data.members?.[user.uid]) { showToast("Already in this group!"); return; }
    await updateDoc(doc(db,"groups",gid), { [`members.${user.uid}`]: { uid:user.uid, name:user.displayName||user.email, email:user.email, photo:user.photoURL||null, role } });
    setActiveGid(gid);
    window.history.replaceState({}, "", window.location.pathname);
    showToast(`Joined "${data.name}" as ${role}! 🎉`);
  }

  // ── Group Actions ─────────────────────────────────────────────────────────
  async function createGroup() {
    if (!newGroup.trim()) return;
    setLoading(true);
    if (isGuest) {
      const newG = { id: uid(), name: newGroup.trim(), members: [], expenses: [], advances: [], settledTxns: [], createdAt: new Date().toISOString() };
      setGroups(prev => [...prev, newG]);
      setActiveGid(newG.id);
      setNewGroup(""); setShowGroup(false);
      showToast(`"${newGroup.trim()}" created!`);
    } else {
      try {
        const ref = await addDoc(collection(db,"groups"), {
          name: newGroup.trim(), createdBy: user.uid, createdAt: serverTimestamp(),
          members: { [user.uid]: { uid:user.uid, name:user.displayName||user.email, email:user.email, photo:user.photoURL||null, role:"owner" } },
          settledTxns: []
        });
        setActiveGid(ref.id);
        setNewGroup(""); setShowGroup(false);
        showToast(`"${newGroup.trim()}" created!`);
      } catch(e) { showToast("Error: "+e.message,"error"); }
    }
    setLoading(false);
  }

  // ── Guest Group Helpers ───────────────────────────────────────────────────
  function guestUpdateGroup(gid, fn) {
    setGroups(prev => prev.map(g => g.id === gid ? fn(g) : g));
  }

  function addGuestMember(name) {
    if (!name.trim()) return;
    guestUpdateGroup(activeGid, g => ({ ...g, members: [...(g.members||[]), { id:uid(), name:name.trim(), uid:uid() }] }));
    showToast(name + " added!");
  }

  async function addCloudMember(name) {
    if (!name.trim()) return;
    const newUid = "manual_" + uid();
    await updateDoc(doc(db,"groups",activeGid), {
      [`members.${newUid}`]: { uid: newUid, name: name.trim(), email: "", photo: null, role: "editor", manual: true }
    });
    showToast(name.trim() + " added!");
  }

  // ── Expense Actions ───────────────────────────────────────────────────────
  function openAddExpense() {
    const mems = isGuest ? (groups.find(g=>g.id===activeGid)?.members||[]) : gMembers;
    setEditingExp(null);
    setExpForm({ description:"", amount:"", paidBy:mems[0]?.name||"", category:"food", date:today(), splitAmong:mems.map(m=>m.name), splitMode:"equal", customAmounts:{} });
    setShowExp(true);
  }

  function openEditExpense(exp) {
    setEditingExp(exp.id);
    setExpForm({ ...exp, amount: String(exp.amount), splitMode: exp.splitMode||"equal", customAmounts: exp.customAmounts||{} });
    setShowExp(true);
  }

  async function saveExpense() {
    if (!expForm.description||!expForm.amount||!expForm.paidBy||!expForm.splitAmong?.length)
      return showToast("Fill all required fields!","error");
    // validate unequal split
    if (expForm.splitMode==="unequal") {
      const total = Object.values(expForm.customAmounts||{}).reduce((s,a)=>s+parseFloat(a||0),0);
      const amt = parseFloat(expForm.amount);
      if (Math.abs(total - amt) > 0.5) return showToast(`Custom amounts (${fmt(total)}) must equal total (${fmt(amt)})!`,"error");
    }
    const exp = { ...expForm, amount: parseFloat(expForm.amount),
      customAmounts: expForm.splitMode==="unequal"
        ? Object.fromEntries(Object.entries(expForm.customAmounts||{}).map(([k,v])=>[k,parseFloat(v||0)]))
        : {} };
    setLoading(true);
    if (isGuest) {
      if (editingExp) {
        guestUpdateGroup(activeGid, g => ({ ...g, expenses: (g.expenses||[]).map(e=>e.id===editingExp?{...e,...exp}:e) }));
      } else {
        guestUpdateGroup(activeGid, g => ({ ...g, expenses: [{ id:uid(), ...exp, createdAt: new Date().toISOString() }, ...(g.expenses||[])] }));
      }
      setShowExp(false); showToast(editingExp?"Expense updated!":'"'+exp.description+'" added!');
    } else {
      try {
        if (editingExp) {
          await updateDoc(doc(db,"groups",activeGid,"expenses",editingExp), exp);
          showToast("Expense updated!");
        } else {
          await addDoc(collection(db,"groups",activeGid,"expenses"), { ...exp, addedBy:user.uid, createdAt:serverTimestamp() });
          showToast('"'+exp.description+'" added!');
        }
        setShowExp(false);
      } catch(e) { showToast("Error: "+e.message,"error"); }
    }
    setLoading(false);
  }

  async function deleteExpense(id) {
    if (isGuest) {
      guestUpdateGroup(activeGid, g => ({ ...g, expenses: (g.expenses||[]).filter(e => e.id !== id) }));
    } else {
      await deleteDoc(doc(db,"groups",activeGid,"expenses",id));
    }
    showToast("Expense removed","warn");
  }

  // ── Advance Actions ───────────────────────────────────────────────────────
  function openAddAdvance() {
    const mems = isGuest ? (groups.find(g=>g.id===activeGid)?.members||[]) : gMembers;
    const others = mems.filter(m => m.name !== (user?.displayName||""));
    setEditingAdv(null);
    setAdvForm({ from:mems[0]?.name||"", to:others[0]?.name||mems[1]?.name||"", amount:"", note:"", date:today() });
    setShowAdv(true);
  }

  function openEditAdvance(adv) {
    setEditingAdv(adv.id);
    setAdvForm({ ...adv, amount: String(adv.amount) });
    setShowAdv(true);
  }

  async function saveAdvance() {
    if (!advForm.from||!advForm.to||!advForm.amount) return showToast("Fill all fields!","error");
    if (advForm.from===advForm.to) return showToast("From and To can't be same!","error");
    const adv = { ...advForm, amount: parseFloat(advForm.amount) };
    setLoading(true);
    if (isGuest) {
      if (editingAdv) {
        guestUpdateGroup(activeGid, g => ({ ...g, advances: (g.advances||[]).map(a=>a.id===editingAdv?{...a,...adv}:a) }));
      } else {
        guestUpdateGroup(activeGid, g => ({ ...g, advances: [{ id:uid(), ...adv, createdAt: new Date().toISOString() }, ...(g.advances||[])] }));
      }
      setShowAdv(false); showToast(editingAdv?"Advance updated!":"Advance recorded!");
    } else {
      try {
        if (editingAdv) {
          await updateDoc(doc(db,"groups",activeGid,"advances",editingAdv), adv);
          showToast("Advance updated!");
        } else {
          await addDoc(collection(db,"groups",activeGid,"advances"), { ...adv, addedBy:user.uid, createdAt:serverTimestamp() });
          showToast("Advance recorded!");
        }
        setShowAdv(false);
      } catch(e) { showToast("Error: "+e.message,"error"); }
    }
    setLoading(false);
  }

  async function deleteAdvance(id) {
    if (isGuest) {
      guestUpdateGroup(activeGid, g => ({ ...g, advances: (g.advances||[]).filter(a => a.id !== id) }));
    } else {
      await deleteDoc(doc(db,"groups",activeGid,"advances",id));
    }
    showToast("Advance removed","warn");
  }

  // ── Settle ────────────────────────────────────────────────────────────────
  async function markSettled(txn) {
    const key = txn.from+"->"+txn.to;
    const updated = [...settledTxns, key];
    if (isGuest) {
      guestUpdateGroup(activeGid, g => ({ ...g, settledTxns: updated }));
      setSettledTxns(updated);
    } else {
      await updateDoc(doc(db,"groups",activeGid), { settledTxns: updated });
    }
    showToast(`${txn.from} → ${txn.to} settled ✓`);
  }

  // ── Share ─────────────────────────────────────────────────────────────────
  function generateLink(role) {
    const base = window.location.origin + window.location.pathname;
    setShareLink(`${base}?join=${activeGid}&role=${role}`);
    setShareRole(role);
  }

  function copyLink() {
    navigator.clipboard.writeText(shareLink).then(() => showToast("Link copied! 📋")).catch(() => showToast("Copy failed","error"));
  }

  // ── Role ──────────────────────────────────────────────────────────────────
  async function changeRole(memberUid, newRole) {
    if (isGuest || memberUid === user?.uid) return;
    await updateDoc(doc(db,"groups",activeGid), { [`members.${memberUid}.role`]: newRole });
    showToast("Role updated ✓");
  }

  async function removeMember(memberUid) {
    if (isGuest || memberUid === user?.uid) return;
    const updated = { ...activeGroup.members };
    delete updated[memberUid];
    await updateDoc(doc(db,"groups",activeGid), { members: updated });
    showToast("Member removed","warn");
  }

  async function renameMember(memberUid, oldName, newName) {
    if (!newName.trim() || newName.trim() === oldName) { setEditingMember(null); return; }
    const trimmed = newName.trim();
    if (isGuest) {
      // update name in members list
      guestUpdateGroup(activeGid, g => ({
        ...g,
        members: (g.members||[]).map(m => m.uid===memberUid ? {...m, name:trimmed} : m),
        // also update name in all expenses and advances
        expenses: (g.expenses||[]).map(e => ({
          ...e,
          paidBy: e.paidBy===oldName ? trimmed : e.paidBy,
          splitAmong: (e.splitAmong||[]).map(n => n===oldName ? trimmed : n),
          customAmounts: e.customAmounts ? Object.fromEntries(Object.entries(e.customAmounts).map(([k,v]) => [k===oldName?trimmed:k, v])) : {}
        })),
        advances: (g.advances||[]).map(a => ({
          ...a,
          from: a.from===oldName ? trimmed : a.from,
          to:   a.to===oldName   ? trimmed : a.to,
        }))
      }));
    } else {
      // 1. Update member name in group doc
      await updateDoc(doc(db,"groups",activeGid), { [`members.${memberUid}.name`]: trimmed });

      // 2. Update all expenses that reference the old name
      const expSnap = await getDocs(collection(db,"groups",activeGid,"expenses"));
      const expUpdates = expSnap.docs
        .filter(d => d.data().paidBy===oldName || (d.data().splitAmong||[]).includes(oldName) || d.data().customAmounts?.[oldName]!==undefined)
        .map(d => {
          const e = d.data();
          const update = {};
          if (e.paidBy === oldName) update.paidBy = trimmed;
          if ((e.splitAmong||[]).includes(oldName))
            update.splitAmong = e.splitAmong.map(n => n===oldName ? trimmed : n);
          if (e.customAmounts?.[oldName] !== undefined) {
            const newAmts = {};
            Object.entries(e.customAmounts).forEach(([k,v]) => { newAmts[k===oldName?trimmed:k] = v; });
            update.customAmounts = newAmts;
          }
          return updateDoc(doc(db,"groups",activeGid,"expenses",d.id), update);
        });

      // 3. Update all advances that reference the old name
      const advSnap = await getDocs(collection(db,"groups",activeGid,"advances"));
      const advUpdates = advSnap.docs
        .filter(d => d.data().from===oldName || d.data().to===oldName)
        .map(d => {
          const a = d.data();
          const update = {};
          if (a.from === oldName) update.from = trimmed;
          if (a.to   === oldName) update.to   = trimmed;
          return updateDoc(doc(db,"groups",activeGid,"advances",d.id), update);
        });

      await Promise.all([...expUpdates, ...advUpdates]);
    }
    setEditingMember(null);
    showToast(`Renamed to "${trimmed}" ✓`);
  }

  const toggleSplit = (name) => setExpForm(p => ({ ...p, splitAmong: p.splitAmong?.includes(name) ? p.splitAmong.filter(n=>n!==name) : [...(p.splitAmong||[]), name] }));

  // ── Export CSV ───────────────────────────────────────────────────────────
  function exportCSV() {
    const groupName = groups.find(g=>g.id===activeGid)?.name || "Group";
    const rows = [
      ["SplitSaathi Export - " + groupName],
      ["Generated:", new Date().toLocaleDateString("en-IN")],
      [],
      ["EXPENSES"],
      ["Date","Description","Category","Amount","Paid By","Split Among","Per Person"],
      ...displayExpenses.map(e=>[
        e.date, e.description,
        CATEGORIES.find(c=>c.id===e.category)?.label||e.category,
        e.amount,e.paidBy,
        (e.splitAmong||[]).join(" | "),
        e.splitMode==="unequal"?"Custom":fmt(e.amount/(e.splitAmong?.length||1))
      ]),
      [],
      ["ADVANCES"],
      ["Date","Note","From","To","Amount"],
      ...displayAdvances.map(a=>[a.date, a.note||"Advance", a.from, a.to, a.amount]),
      [],
      ["BALANCES"],
      ["Member","Status","Amount"],
      ...displayMembers.map(m=>{
        const b = balances2[m.name]||0;
        return [m.name, b>0.01?"Gets Back":b<-0.01?"Owes":"Settled", fmt(Math.abs(b))];
      }),
      [],
      ["SETTLEMENTS"],
      ["From","To","Amount"],
      ...settlements2.map(s=>[s.from, s.to, fmt(s.amount)]),
    ];
    const csvRows = rows.map(r => r.map(c => {
      const s = String(c === null || c === undefined ? "" : c);
      return '"' + s.split('"').join('""') + '"';
    }).join(","));
    const csv = csvRows.join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = groupName.replace(/\s+/g,"_")+"_SplitSaathi.csv";
    a.click(); URL.revokeObjectURL(url);
    showToast("Exported! Check your downloads 📥");
  }

  // ── Guest Member state sync ───────────────────────────────────────────────
  const displayMembers = isGuest ? (groups.find(g=>g.id===activeGid)?.members||[]) : gMembers;
  const displayExpenses = (isGuest ? (groups.find(g=>g.id===activeGid)?.expenses||[]) : expenses).slice().sort((a,b)=>{ const ta=a.createdAt?.seconds||new Date(a.createdAt||0).getTime()/1000||0; const tb=b.createdAt?.seconds||new Date(b.createdAt||0).getTime()/1000||0; return tb-ta; });
  const displayAdvances = isGuest ? (groups.find(g=>g.id===activeGid)?.advances||[]) : advances;
  const displaySettled  = isGuest ? (groups.find(g=>g.id===activeGid)?.settledTxns||[]) : settledTxns;
  const balances2    = computeBalances(displayMembers, displayExpenses, displayAdvances);
  const settlements2 = computeSettlements(balances2);
  const totalSpent2  = displayExpenses.reduce((s,e)=>s+e.amount,0);
  const totalAdv2    = displayAdvances.reduce((s,a)=>s+a.amount,0);

  // ── Guest member add state ────────────────────────────────────────────────
  const [newMemberName,  setNewMemberName]  = useState("");
  const [editingMember,  setEditingMember]  = useState(null); // { uid, name, isGuest }
  const [editMemberName, setEditMemberName] = useState("");

  // ── Auth Loading ──────────────────────────────────────────────────────────
  if (authLoading && !isGuest) return (
    <div style={{ minHeight:"100vh", background:"#0a0c16", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, fontFamily:"Poppins,sans-serif" }}>
      <div style={{ width:54, height:54, borderRadius:16, background:"linear-gradient(135deg,#FF6B6B,#FFD93D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>✂</div>
      <div style={{ color:"#4D96FF", fontSize:13 }}>Loading SplitSaathi...</div>
    </div>
  );

  // ── Auth Screen ───────────────────────────────────────────────────────────
  if (!user && !isGuest) return (
    <div style={{ minHeight:"100vh", background:"#0a0c16", fontFamily:"Poppins,sans-serif", color:"#f0f4ff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Logo */}
      <div style={{ width:72, height:72, borderRadius:22, background:"linear-gradient(135deg,#FF6B6B,#FFD93D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:38, marginBottom:14 }}>✂</div>
      <div style={{ fontSize:26, fontWeight:800, marginBottom:4 }}>SplitSaathi</div>
      <div style={{ fontSize:12, color:"#6a7aaa", marginBottom:28, textAlign:"center" }}>Split expenses with friends & family</div>

      {/* Guest Button */}
      <button onClick={enterGuest} style={{ width:"100%", maxWidth:340, background:"linear-gradient(135deg,#2ed573,#1abc9c)", border:"none", borderRadius:14, padding:"14px", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif", marginBottom:10, boxShadow:"0 4px 20px #2ed57344" }}>
        🚀 Continue without Sign-in
      </button>
      <div style={{ fontSize:10, color:"#3a4470", marginBottom:22, textAlign:"center" }}>Data saved on this device only</div>

      <div style={{ width:"100%", maxWidth:340, display:"flex", alignItems:"center", gap:10, marginBottom:22 }}>
        <div style={{ flex:1, height:1, background:"#1e2442" }} />
        <span style={{ fontSize:11, color:"#3a4470" }}>OR SIGN IN FOR CLOUD SYNC</span>
        <div style={{ flex:1, height:1, background:"#1e2442" }} />
      </div>

      {/* Tab Switch */}
      <div style={{ display:"flex", background:"#13172a", borderRadius:12, padding:4, marginBottom:18, width:"100%", maxWidth:340 }}>
        {[["magic","📧 Magic Link"],["password","🔑 Password"]].map(([t,l]) => (
          <button key={t} onClick={()=>{ setAuthTab(t); setAuthError(""); setMagicSent(false); }} style={{ flex:1, background:authTab===t?"#4D96FF":"transparent", border:"none", borderRadius:9, padding:"9px 6px", color:authTab===t?"#fff":"#6a7aaa", fontSize:12, fontWeight:authTab===t?700:400, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>{l}</button>
        ))}
      </div>

      <div style={{ width:"100%", maxWidth:340 }}>
        {/* Magic Link Tab */}
        {authTab === "magic" && (
          magicSent ? (
            <div style={{ background:"#1a2a1a", border:"1px solid #2ed57344", borderRadius:14, padding:"20px 16px", textAlign:"center" }}>
              <div style={{ fontSize:40, marginBottom:10 }}>📧</div>
              <div style={{ fontSize:15, fontWeight:700, color:"#2ed573", marginBottom:8 }}>Check your inbox!</div>
              <div style={{ fontSize:12, color:"#a0e0b0", lineHeight:1.7 }}>We sent a magic link to<br/><b style={{ color:"#f0f4ff" }}>{magicEmail}</b><br/>Tap the link to sign in instantly!</div>
              <button onClick={()=>{ setMagicSent(false); setMagicEmail(""); }} style={{ marginTop:16, background:"transparent", border:"1px solid #2a3060", borderRadius:8, padding:"8px 18px", color:"#6a7aaa", fontSize:12, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>Try different email</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Your Email</div>
                <input type="email" placeholder="you@example.com" value={magicEmail} onChange={e=>setMagicEmail(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendMagicLink()}
                  style={{ width:"100%", background:"#13172a", border:"1px solid #2a3060", borderRadius:10, padding:"12px 14px", color:"#f0f4ff", fontSize:14, outline:"none", fontFamily:"Poppins,sans-serif", boxSizing:"border-box" }} />
              </div>
              {authError && <div style={{ marginBottom:10, background:"#ff475720", border:"1px solid #ff4757", borderRadius:10, padding:"9px 12px", fontSize:12, color:"#ff4757" }}>⚠️ {authError}</div>}
              <BigBtn onClick={sendMagicLink} disabled={authLoading2} grad="linear-gradient(135deg,#4D96FF,#6C63FF)">{authLoading2?"Sending...":"Send Magic Link 📧"}</BigBtn>
              <div style={{ fontSize:11, color:"#3a4470", marginTop:10, textAlign:"center", lineHeight:1.7 }}>We'll email you a link — no password needed!<br/>📂 Don't see it? Check your <span style={{ color:"#FFD93D" }}>spam/junk</span> folder.</div>
            </>
          )
        )}

        {/* Password Tab */}
        {authTab === "password" && (
          <>
            <div style={{ display:"flex", background:"#0d1124", borderRadius:10, padding:3, marginBottom:14 }}>
              {[["login","Login"],["register","Register"]].map(([t,l]) => (
                <button key={t} onClick={()=>{ setAuthForm(p=>({...p})); setAuthError(""); }} style={{ flex:1, background:"transparent", border:"none", padding:"8px", color:"#6a7aaa", fontSize:12, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}
                  className={t}>{l}</button>
              ))}
            </div>

            {/* Simple register/login — show name only on register */}
            <div style={{ display:"flex", gap:6, marginBottom:10 }}>
              <button onClick={()=>setAuthForm(p=>({...p,_mode:"login"}))} style={{ flex:1, background:authForm._mode!=="register"?"#4D96FF":"#1e2442", border:"none", borderRadius:8, padding:"8px", color:authForm._mode!=="register"?"#fff":"#6a7aaa", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>Login</button>
              <button onClick={()=>setAuthForm(p=>({...p,_mode:"register"}))} style={{ flex:1, background:authForm._mode==="register"?"#4D96FF":"#1e2442", border:"none", borderRadius:8, padding:"8px", color:authForm._mode==="register"?"#fff":"#6a7aaa", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>Register</button>
            </div>

            {authForm._mode==="register" && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Your Name</div>
                <input placeholder="e.g. Rahul Sharma" value={authForm.name} onChange={e=>setAuthForm(p=>({...p,name:e.target.value}))}
                  style={{ width:"100%", background:"#13172a", border:"1px solid #2a3060", borderRadius:10, padding:"12px 14px", color:"#f0f4ff", fontSize:14, outline:"none", fontFamily:"Poppins,sans-serif", boxSizing:"border-box" }} />
              </div>
            )}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Email</div>
              <input type="email" placeholder="you@example.com" value={authForm.email} onChange={e=>setAuthForm(p=>({...p,email:e.target.value}))}
                style={{ width:"100%", background:"#13172a", border:"1px solid #2a3060", borderRadius:10, padding:"12px 14px", color:"#f0f4ff", fontSize:14, outline:"none", fontFamily:"Poppins,sans-serif", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:"#6a7aaa", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Password</div>
              <input type="password" placeholder="Min 6 characters" value={authForm.password} onChange={e=>setAuthForm(p=>({...p,password:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&(authForm._mode==="register"?register():login())}
                style={{ width:"100%", background:"#13172a", border:"1px solid #2a3060", borderRadius:10, padding:"12px 14px", color:"#f0f4ff", fontSize:14, outline:"none", fontFamily:"Poppins,sans-serif", boxSizing:"border-box" }} />
            </div>
            {authError && <div style={{ marginBottom:12, background:"#ff475720", border:"1px solid #ff4757", borderRadius:10, padding:"9px 12px", fontSize:12, color:"#ff4757" }}>⚠️ {authError}</div>}
            <BigBtn onClick={authForm._mode==="register"?register:login} disabled={authLoading2}>
              {authLoading2?"Please wait...":(authForm._mode==="register"?"Create Account →":"Login →")}
            </BigBtn>
          </>
        )}
      </div>
    </div>
  );

  // ── Main App ──────────────────────────────────────────────────────────────
  const userName = isGuest ? "Guest" : (user?.displayName||user?.email||"You");

  return (
    <div style={{ minHeight:"100vh", background:"#0a0c16", fontFamily:"Poppins,sans-serif", color:"#f0f4ff", maxWidth:480, margin:"0 auto", paddingBottom:90 }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:9999, background:toast.type==="error"?"#ff4757ee":toast.type==="warn"?"#ffa502ee":"#2ed573ee", borderRadius:12, padding:"10px 22px", fontSize:13, color:"#fff", fontWeight:600, boxShadow:"0 8px 24px rgba(0,0,0,0.4)", whiteSpace:"nowrap", animation:"slideDown 0.3s ease" }}>
          {toast.type==="success"?"✓ ":toast.type==="error"?"✗ ":"⚠ "}{toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#1a1f3a,#0f1226)", padding:"14px 14px 0", borderBottom:"1px solid #1e2442" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#FF6B6B,#FFD93D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>✂</div>
            <div>
              <div style={{ fontSize:15, fontWeight:800 }}>SplitSaathi</div>
              {isGuest && <div style={{ fontSize:9, color:"#2ed573", letterSpacing:1 }}>GUEST MODE · LOCAL ONLY</div>}
              {!isGuest && <div style={{ fontSize:9, color:"#4D96FF", letterSpacing:1 }}>☁️ CLOUD SYNC · {userName}</div>}
            </div>
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {activeGid && !isGuest && can.canManage && (
              <button onClick={()=>{ generateLink(shareRole); }} style={{ background:"#1e2442", border:"1px solid #2a3060", borderRadius:8, padding:"5px 10px", color:"#4D96FF", fontSize:10, cursor:"pointer", fontWeight:600 }}>🔗 Share</button>
            )}
            {activeGid && <button onClick={exportCSV} style={{ background:"#1e2442", border:"1px solid #2a3060", borderRadius:8, padding:"5px 10px", color:"#2ed573", fontSize:10, cursor:"pointer", fontWeight:600 }}>📥 Export</button>}
            <button onClick={()=>setShowGroup(true)} style={{ background:"#1e2442", border:"1px solid #2a3060", borderRadius:8, padding:"5px 10px", color:"#FFD93D", fontSize:10, cursor:"pointer", fontWeight:600 }}>+ Group</button>
            <button onClick={logout} style={{ background:"#ff475722", border:"1px solid #ff475744", borderRadius:8, padding:"5px 10px", color:"#ff4757", fontSize:10, cursor:"pointer", fontWeight:600 }}>Exit</button>
          </div>
        </div>

        {groups.length > 0 && (
          <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:1 }}>
            {groups.map(g => (
              <button key={g.id} onClick={()=>{ setActiveGid(g.id); setTab("expenses"); }} style={{ background:activeGid===g.id?"#4D96FF":"transparent", border:activeGid===g.id?"none":"1px solid #2a3060", borderRadius:"8px 8px 0 0", padding:"6px 14px", color:activeGid===g.id?"#fff":"#6a7aaa", fontSize:11, cursor:"pointer", whiteSpace:"nowrap", fontWeight:activeGid===g.id?700:400, fontFamily:"Poppins,sans-serif" }}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No groups */}
      {groups.length === 0 && (
        <div style={{ textAlign:"center", padding:"60px 24px" }}>
          <div style={{ fontSize:56, marginBottom:14 }}>✂️</div>
          <div style={{ fontSize:19, fontWeight:800, marginBottom:8 }}>Welcome{isGuest?"":", "+userName.split(" ")[0]}!</div>
          <div style={{ fontSize:12, color:"#6a7aaa", marginBottom:28, lineHeight:1.7 }}>
            {isGuest ? "You're in guest mode. Data saves on this device." : "Create a group to start splitting expenses!"}
          </div>
          <button onClick={()=>setShowGroup(true)} style={{ background:"linear-gradient(135deg,#FF6B6B,#FF922B)", border:"none", borderRadius:14, padding:"13px 30px", color:"#fff", fontSize:14, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>+ Create First Group</button>
        </div>
      )}

      {/* Stats + Nav + Content */}
      {activeGid && (
        <>
          {/* Stats */}
          <div style={{ background:"#0f1226", padding:"10px 12px", display:"flex", gap:7, borderBottom:"1px solid #1e2442" }}>
            {[
              { label:"Spent",    value:fmt(totalSpent2), color:"#f0f4ff" },
              { label:"Advances", value:fmt(totalAdv2),   color:"#FFD93D" },
              { label:"Members",  value:displayMembers.length, color:"#4D96FF" },
              { label:"Role",     value:(isGuest?"👑 Owner":ROLES[myRole]?.icon+" "+ROLES[myRole]?.label), color:"#CC5DE8" },
            ].map((s,i) => (
              <div key={i} style={{ flex:1, background:"#13172a", borderRadius:10, padding:"7px 4px", textAlign:"center" }}>
                <div style={{ fontSize:11, fontWeight:700, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:8, color:"#6a7aaa", marginTop:1 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Nav */}
          <div style={{ display:"flex", background:"#0f1226", borderBottom:"1px solid #1e2442" }}>
            {[
              { id:"expenses", label:"Expenses", icon:"📋" },
              { id:"advances", label:"Advances", icon:"💰" },
              { id:"balances", label:"Balances", icon:"⚖️"  },
              { id:"settle",   label:"Settle",   icon:"💸"  },
              { id:"members",  label:"Members",  icon:"👥"  },
            ].map(t => (
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, background:"transparent", border:"none", borderBottom:tab===t.id?"2px solid #4D96FF":"2px solid transparent", padding:"10px 2px", color:tab===t.id?"#4D96FF":"#6a7aaa", fontSize:9, cursor:"pointer", fontWeight:tab===t.id?700:400, fontFamily:"Poppins,sans-serif", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                <span style={{ fontSize:13 }}>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>

          <div style={{ padding:12 }}>

            {/* EXPENSES */}
            {tab==="expenses" && (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <span style={{ fontSize:12, color:"#6a7aaa" }}>{displayExpenses.length} expense{displayExpenses.length!==1?"s":""}</span>
                  {can.canEdit && <button onClick={openAddExpense} style={{ background:"linear-gradient(135deg,#4D96FF,#6C63FF)", border:"none", borderRadius:10, padding:"7px 15px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>+ Add</button>}
                </div>
                {displayExpenses.length===0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0", color:"#3a4470" }}>
                    <div style={{ fontSize:42, marginBottom:10 }}>🧾</div>
                    <div style={{ fontSize:13, fontWeight:600 }}>No expenses yet</div>
                    {!can.canEdit && <div style={{ fontSize:11, marginTop:5, color:"#6a7aaa" }}>View-only access</div>}
                  </div>
                ) : displayExpenses.map(exp => {
                  const cat = CATEGORIES.find(c=>c.id===exp.category);
                  return (
                    <div key={exp.id} style={{ background:"#13172a", border:"1px solid #1e2442", borderRadius:14, padding:"11px 12px", marginBottom:8, display:"flex", gap:9 }}>
                      <div style={{ width:36, height:36, borderRadius:9, background:"#1e2442", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{cat?.icon||"📦"}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", justifyContent:"space-between" }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700 }}>{exp.description}</div>
                            <div style={{ fontSize:10, color:"#6a7aaa", marginTop:1 }}>{exp.date} · <span style={{ color:mColor(exp.paidBy,displayMembers) }}>{exp.paidBy}</span></div>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0 }}>
                            <div style={{ fontSize:14, fontWeight:800, color:"#FFD93D" }}>{fmt(exp.amount)}</div>
                            <div style={{ fontSize:9, color:"#6a7aaa" }}>{exp.splitMode==="unequal"?"custom split":fmt(exp.amount/(exp.splitAmong?.length||1))+"/person"}</div>
                          </div>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
                          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                            {(exp.splitAmong||[]).map(name=>(
                              <span key={name} style={{ background:mColor(name,displayMembers)+"22", border:`1px solid ${mColor(name,displayMembers)}44`, borderRadius:5, padding:"1px 5px", fontSize:9, color:mColor(name,displayMembers), fontWeight:600 }}>{name}</span>
                            ))}
                          </div>
                          <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                            {can.canEdit && <button onClick={()=>openEditExpense(exp)} style={{ background:"#4D96FF22", border:"none", borderRadius:5, padding:"2px 7px", color:"#4D96FF", fontSize:10, cursor:"pointer" }}>✏️</button>}
                            {can.canDelete && <button onClick={()=>deleteExpense(exp.id)} style={{ background:"#ff475722", border:"none", borderRadius:5, padding:"2px 7px", color:"#ff4757", fontSize:10, cursor:"pointer" }}>✕</button>}
                          </div>
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
                <div style={{ background:"#1a2a1a", border:"1px solid #2ed57344", borderRadius:12, padding:"9px 12px", marginBottom:12, display:"flex", gap:8 }}>
                  <span style={{ fontSize:16 }}>💡</span>
                  <div style={{ fontSize:11, color:"#a0e0b0", lineHeight:1.6 }}>Record money given <b>before</b> a trip. Auto-adjusts final balances.</div>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <span style={{ fontSize:12, color:"#6a7aaa" }}>{displayAdvances.length} advance{displayAdvances.length!==1?"s":""} · {fmt(totalAdv2)}</span>
                  {can.canEdit && <button onClick={openAddAdvance} style={{ background:"linear-gradient(135deg,#FFD93D,#FF922B)", border:"none", borderRadius:10, padding:"7px 15px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>+ Add</button>}
                </div>
                {displayAdvances.length===0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0", color:"#3a4470" }}><div style={{ fontSize:42, marginBottom:10 }}>💰</div><div style={{ fontSize:13, fontWeight:600 }}>No advances</div></div>
                ) : displayAdvances.map(adv => (
                  <div key={adv.id} style={{ background:"#13172a", border:"1px solid #FFD93D33", borderRadius:14, padding:"11px 12px", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                      <div style={{ width:34,height:34,borderRadius:9,background:"#FFD93D22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0 }}>💰</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{adv.note||"Advance Payment"}</div>
                        <div style={{ fontSize:10, color:"#6a7aaa" }}>{adv.date}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:800, color:"#FFD93D" }}>{fmt(adv.amount)}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:12 }}>
                        <Av name={adv.from} members={displayMembers} size={22} />
                        <span style={{ color:mColor(adv.from,displayMembers), fontWeight:700 }}>{adv.from}</span>
                        <span style={{ color:"#4D96FF" }}>→</span>
                        <Av name={adv.to} members={displayMembers} size={22} />
                        <span style={{ color:mColor(adv.to,displayMembers), fontWeight:700 }}>{adv.to}</span>
                      </div>
                      <div style={{ display:"flex", gap:4 }}>
                        {can.canEdit && <button onClick={()=>openEditAdvance(adv)} style={{ background:"#FFD93D22", border:"none", borderRadius:5, padding:"2px 7px", color:"#FFD93D", fontSize:10, cursor:"pointer" }}>✏️</button>}
                        {can.canDelete && <button onClick={()=>deleteAdvance(adv.id)} style={{ background:"#ff475722", border:"none", borderRadius:5, padding:"2px 7px", color:"#ff4757", fontSize:10, cursor:"pointer" }}>✕</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* BALANCES */}
            {tab==="balances" && (
              <div>
                <div style={{ fontSize:11, color:"#3a4470", marginBottom:12, background:"#13172a", borderRadius:10, padding:"8px 12px" }}>⚖️ Includes expenses + advances · Green = gets back · Red = owes</div>
                {displayMembers.map((m,i) => {
                  const bal = balances2[m.name]||0;
                  const isOwed=bal>0.01, owes=bal<-0.01;
                  return (
                    <div key={m.uid||m.id||i} style={{ background:"#13172a", border:`1px solid ${isOwed?"#2ed57344":owes?"#ff475744":"#1e2442"}`, borderRadius:14, padding:"11px 13px", marginBottom:7, display:"flex", alignItems:"center", gap:9 }}>
                      <Av name={m.name} photo={m.photo} members={displayMembers} size={38} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{m.name}{m.uid===user?.uid?" (you)":""}</div>
                        <div style={{ fontSize:10, color:"#6a7aaa", marginTop:1 }}>{isOwed?"gets back":owes?"owes":"settled ✓"}</div>
                      </div>
                      <div style={{ fontSize:15, fontWeight:800, color:isOwed?"#2ed573":owes?"#ff4757":"#6a7aaa" }}>
                        {isOwed?"+":owes?"-":""}{Math.abs(bal)>0.01?fmt(bal):"₹0"}
                      </div>
                    </div>
                  );
                })}
                {totalSpent2>0 && (
                  <>
                    <div style={{ marginTop:14, marginBottom:7, fontSize:12, color:"#6a7aaa" }}>By category</div>
                    {CATEGORIES.map(cat => {
                      const total = displayExpenses.filter(e=>e.category===cat.id).reduce((s,e)=>s+e.amount,0);
                      if (!total) return null;
                      return (
                        <div key={cat.id} style={{ marginBottom:7 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                            <span style={{ fontSize:11 }}>{cat.icon} {cat.label}</span>
                            <span style={{ fontSize:11, fontWeight:700, color:"#FFD93D" }}>{fmt(total)}</span>
                          </div>
                          <div style={{ background:"#1e2442", borderRadius:4, height:5 }}>
                            <div style={{ width:((total/totalSpent2)*100)+"%", background:"linear-gradient(90deg,#4D96FF,#6C63FF)", borderRadius:4, height:"100%" }} />
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* SETTLE */}
            {tab==="settle" && (
              <div>
                <div style={{ fontSize:11, color:"#3a4470", marginBottom:12, background:"#13172a", borderRadius:10, padding:"8px 12px" }}>💸 Minimum transactions · Advances & expenses included</div>
                {settlements2.length===0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0" }}>
                    <div style={{ fontSize:44, marginBottom:10 }}>🎉</div>
                    <div style={{ fontSize:14, fontWeight:600, color:"#2ed573" }}>All settled up!</div>
                  </div>
                ) : settlements2.map((s,i) => {
                  const key=s.from+"->"+s.to, done=displaySettled.includes(key);
                  return (
                    <div key={i} style={{ background:"#13172a", border:`1px solid ${done?"#2ed57344":"#2a3060"}`, borderRadius:14, padding:13, marginBottom:8, opacity:done?0.5:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:9 }}>
                        <Av name={s.from} members={displayMembers} size={34} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, color:"#6a7aaa" }}>needs to pay</div>
                          <div style={{ fontSize:17, fontWeight:800, color:"#FF6B6B" }}>{fmt(s.amount)}</div>
                        </div>
                        <div style={{ fontSize:18, color:"#4D96FF" }}>→</div>
                        <Av name={s.to} members={displayMembers} size={34} />
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontSize:12 }}>
                          <span style={{ color:mColor(s.from,displayMembers), fontWeight:700 }}>{s.from}</span>
                          <span style={{ color:"#6a7aaa" }}> pays </span>
                          <span style={{ color:mColor(s.to,displayMembers), fontWeight:700 }}>{s.to}</span>
                        </div>
                        {!done
                          ? <button onClick={()=>markSettled(s)} style={{ background:"linear-gradient(135deg,#2ed573,#1abc9c)", border:"none", borderRadius:8, padding:"6px 13px", color:"#fff", fontSize:11, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>Settled ✓</button>
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
                {/* Share link (cloud only) */}
                {!isGuest && can.canManage && (
                  <div style={{ background:"#13172a", border:"1px solid #2a3060", borderRadius:12, padding:"12px 13px", marginBottom:12 }}>
                    <div style={{ fontSize:10, color:"#6a7aaa", marginBottom:8 }}>🔗 INVITE VIA LINK</div>
                    <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:9 }}>
                      {Object.entries(ROLES).filter(([k])=>k!=="owner").map(([k,v]) => (
                        <Pill key={k} active={shareRole===k} color={k==="admin"?"#CC5DE8":k==="editor"?"#4D96FF":"#6a7aaa"} onClick={()=>{ setShareRole(k); generateLink(k); }}>{v.icon} {v.label}</Pill>
                      ))}
                    </div>
                    {shareLink ? (
                      <div style={{ display:"flex", gap:6 }}>
                        <div style={{ flex:1, background:"#0d1124", border:"1px solid #2a3060", borderRadius:8, padding:"7px 9px", fontSize:10, color:"#6a7aaa", wordBreak:"break-all" }}>{shareLink}</div>
                        <button onClick={copyLink} style={{ background:"#4D96FF", border:"none", borderRadius:8, padding:"0 12px", color:"#fff", fontSize:11, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif", flexShrink:0 }}>Copy</button>
                      </div>
                    ) : (
                      <button onClick={()=>generateLink(shareRole)} style={{ width:"100%", background:"linear-gradient(135deg,#4D96FF,#6C63FF)", border:"none", borderRadius:8, padding:"9px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>Generate Invite Link 🔗</button>
                    )}
                  </div>
                )}

                {/* Add member manually — both guest and cloud */}
                {(isGuest || can.canManage) && (
                  <div style={{ background:"#13172a", border:"1px solid #2a3060", borderRadius:12, padding:"12px 13px", marginBottom:12 }}>
                    <div style={{ fontSize:10, color:"#6a7aaa", marginBottom:8 }}>👤 ADD MEMBER MANUALLY</div>
                    <div style={{ display:"flex", gap:6 }}>
                      <input placeholder="Member name e.g. Rahul" value={newMemberName} onChange={e=>setNewMemberName(e.target.value)}
                        onKeyDown={e=>{ if(e.key==="Enter"){ isGuest?addGuestMember(newMemberName):addCloudMember(newMemberName); setNewMemberName(""); } }}
                        style={{ flex:1, background:"#0d1124", border:"1px solid #2a3060", borderRadius:8, padding:"9px 11px", color:"#f0f4ff", fontSize:13, outline:"none", fontFamily:"Poppins,sans-serif" }} />
                      <button onClick={()=>{ isGuest?addGuestMember(newMemberName):addCloudMember(newMemberName); setNewMemberName(""); }}
                        style={{ background:"#4D96FF", border:"none", borderRadius:8, padding:"0 14px", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"Poppins,sans-serif" }}>Add</button>
                    </div>
                    {!isGuest && <div style={{ fontSize:10, color:"#3a4470", marginTop:7 }}>💡 They can also join via invite link to sync their own data</div>}
                  </div>
                )}

                {displayMembers.length===0 ? (
                  <div style={{ textAlign:"center", padding:"30px 0", color:"#3a4470" }}>
                    <div style={{ fontSize:36, marginBottom:8 }}>👥</div>
                    <div style={{ fontSize:13 }}>Add members above or invite via link</div>
                  </div>
                ) : displayMembers.map((m,i) => {
                  const role = ROLES[m.role]||ROLES.viewer;
                  const isEditingThis = editingMember?.uid === (m.uid||m.id);
                  return (
                    <div key={m.uid||m.id||i} style={{ background:"#13172a", border:`1px solid ${isEditingThis?"#4D96FF":"#1e2442"}`, borderRadius:14, padding:"11px 13px", marginBottom:7 }}>
                      {/* Inline rename input */}
                      {isEditingThis ? (
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          <Av name={m.name} photo={m.photo} members={displayMembers} size={34} />
                          <input
                            autoFocus
                            value={editMemberName}
                            onChange={e=>setEditMemberName(e.target.value)}
                            onKeyDown={e=>{ if(e.key==="Enter") renameMember(m.uid||m.id, m.name, editMemberName); if(e.key==="Escape") setEditingMember(null); }}
                            style={{ flex:1, background:"#0d1124", border:"1px solid #4D96FF", borderRadius:8, padding:"8px 11px", color:"#f0f4ff", fontSize:13, outline:"none", fontFamily:"Poppins,sans-serif" }}
                          />
                          <button onClick={()=>renameMember(m.uid||m.id, m.name, editMemberName)} style={{ background:"#2ed573", border:"none", borderRadius:7, padding:"7px 12px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>Save</button>
                          <button onClick={()=>setEditingMember(null)} style={{ background:"#1e2442", border:"none", borderRadius:7, padding:"7px 10px", color:"#6a7aaa", fontSize:11, cursor:"pointer" }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display:"flex", gap:9, alignItems:"center" }}>
                          <Av name={m.name} photo={m.photo} members={displayMembers} size={40} />
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:700 }}>{m.name}{m.uid===user?.uid?" (you)":""}</div>
                            {!isGuest && <div style={{ fontSize:10, color:"#6a7aaa", marginTop:1 }}>{m.email}</div>}
                            {!isGuest && can.canManage && m.uid!==user?.uid && (
                              <div style={{ marginTop:5, display:"flex", gap:3, flexWrap:"wrap" }}>
                                {Object.entries(ROLES).filter(([k])=>k!=="owner").map(([k,v]) => (
                                  <button key={k} onClick={()=>changeRole(m.uid,k)} style={{ background:m.role===k?"#4D96FF33":"#1e2442", border:`1px solid ${m.role===k?"#4D96FF":"#2a3060"}`, borderRadius:5, padding:"2px 7px", color:m.role===k?"#4D96FF":"#6a7aaa", fontSize:9, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>{v.icon} {v.label}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5 }}>
                            {!isGuest && <span style={{ fontSize:10, fontWeight:700, color:m.role==="owner"?"#FFD93D":m.role==="admin"?"#CC5DE8":"#4D96FF" }}>{role.icon} {role.label}</span>}
                            <div style={{ display:"flex", gap:4 }}>
                              {(isGuest || can.canManage) && (
                                <button onClick={()=>{ setEditingMember({uid:m.uid||m.id, name:m.name}); setEditMemberName(m.name); }} style={{ background:"#4D96FF22", border:"none", borderRadius:5, padding:"2px 7px", color:"#4D96FF", fontSize:10, cursor:"pointer" }}>✏️</button>
                              )}
                              {!isGuest && can.canManage && m.uid!==user?.uid && (
                                <button onClick={()=>removeMember(m.uid)} style={{ background:"#ff475722", border:"none", borderRadius:5, padding:"2px 7px", color:"#ff4757", fontSize:9, cursor:"pointer" }}>Remove</button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
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
        <button onClick={openAddExpense} style={{ position:"fixed", bottom:24, right:20, width:50, height:50, borderRadius:"50%", background:"linear-gradient(135deg,#4D96FF,#6C63FF)", border:"none", color:"#fff", fontSize:26, cursor:"pointer", boxShadow:"0 6px 20px #4D96FF66", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>+</button>
      )}
      {activeGid && can.canEdit && tab==="advances" && (
        <button onClick={openAddAdvance} style={{ position:"fixed", bottom:24, right:20, width:50, height:50, borderRadius:"50%", background:"linear-gradient(135deg,#FFD93D,#FF922B)", border:"none", color:"#fff", fontSize:26, cursor:"pointer", boxShadow:"0 6px 20px #FFD93D66", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>+</button>
      )}

      {/* ADD/EDIT EXPENSE MODAL */}
      {showExp && (
        <Modal title={editingExp ? "✏️ Edit Expense" : "➕ Add Expense"} onClose={()=>setShowExp(false)}>
          <TInput label="Description *" placeholder="e.g. Hotel booking" value={expForm.description||""} onChange={e=>setExpForm(p=>({...p,description:e.target.value}))} />
          <TInput label="Amount (₹) *" type="number" placeholder="0.00" value={expForm.amount||""} onChange={e=>setExpForm(p=>({...p,amount:e.target.value}))} />
          <Field label="Category">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {CATEGORIES.map(c=><Pill key={c.id} active={expForm.category===c.id} onClick={()=>setExpForm(p=>({...p,category:c.id}))}>{c.icon} {c.label}</Pill>)}
            </div>
          </Field>
          <Field label="Paid By *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {displayMembers.map(m=><Pill key={m.uid||m.id} active={expForm.paidBy===m.name} color={mColor(m.name,displayMembers)} onClick={()=>setExpForm(p=>({...p,paidBy:m.name}))}>{m.name}</Pill>)}
            </div>
          </Field>

          {/* Split Mode Toggle */}
          <Field label="Split Type">
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={()=>setExpForm(p=>({ ...p, splitMode:"equal", splitAmong: displayMembers.map(m=>m.name), customAmounts:{} }))} style={{ flex:1, background:expForm.splitMode!=="unequal"?"#4D96FF":"#1e2442", border:"none", borderRadius:8, padding:"9px", color:expForm.splitMode!=="unequal"?"#fff":"#6a7aaa", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>⚖️ Equal</button>
              <button onClick={()=>setExpForm(p=>({ ...p, splitMode:"unequal", customAmounts: Object.fromEntries(displayMembers.map(m=>[m.name,""])) }))} style={{ flex:1, background:expForm.splitMode==="unequal"?"#FF922B":"#1e2442", border:"none", borderRadius:8, padding:"9px", color:expForm.splitMode==="unequal"?"#fff":"#6a7aaa", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Poppins,sans-serif" }}>✏️ Unequal</button>
            </div>
          </Field>

          {/* Equal Split */}
          {expForm.splitMode !== "unequal" && (
            <Field label="Split Among *">
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {displayMembers.map(m=>(
                  <button key={m.uid||m.id} onClick={()=>toggleSplit(m.name)} style={{ background:expForm.splitAmong?.includes(m.name)?mColor(m.name,displayMembers)+"44":"#1e2442", border:`1px solid ${expForm.splitAmong?.includes(m.name)?mColor(m.name,displayMembers):"#2a3060"}`, borderRadius:8, padding:"5px 11px", color:expForm.splitAmong?.includes(m.name)?mColor(m.name,displayMembers):"#6a7aaa", fontSize:11, cursor:"pointer", fontFamily:"Poppins,sans-serif", fontWeight:600 }}>
                    {expForm.splitAmong?.includes(m.name)?"✓ ":""}{m.name}
                  </button>
                ))}
              </div>
              {expForm.splitAmong?.length>0 && expForm.amount && (
                <div style={{ marginTop:8, background:"#1e2442", borderRadius:8, padding:"7px 12px", fontSize:11, color:"#FFD93D", fontWeight:700, textAlign:"center" }}>
                  ⚖️ {fmt(parseFloat(expForm.amount||0)/expForm.splitAmong.length)} per person × {expForm.splitAmong.length} people
                </div>
              )}
            </Field>
          )}

          {/* Unequal Split */}
          {expForm.splitMode === "unequal" && (
            <Field label="Custom Amounts *">
              <div style={{ background:"#0d1124", borderRadius:10, padding:"10px", marginBottom:8 }}>
                {displayMembers.map(m => {
                  const val = expForm.customAmounts?.[m.name] || "";
                  const active = parseFloat(val||0) > 0;
                  return (
                    <div key={m.uid||m.id} style={{ display:"flex", alignItems:"center", gap:9, marginBottom:9 }}>
                      <div style={{ width:30, height:30, borderRadius:"50%", background:active?mColor(m.name,displayMembers)+"44":"#1e2442", border:`2px solid ${active?mColor(m.name,displayMembers):"#2a3060"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:active?mColor(m.name,displayMembers):"#6a7aaa", flexShrink:0, transition:"all 0.15s" }}>{avTx(m.name)}</div>
                      <span style={{ flex:1, fontSize:12, fontWeight:600, color:active?"#f0f4ff":"#6a7aaa" }}>{m.name}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <span style={{ fontSize:12, color:"#6a7aaa" }}>₹</span>
                        <input type="number" placeholder="0.00" value={val}
                          onChange={e=>{
                            const newAmts = {...(expForm.customAmounts||{}), [m.name]: e.target.value};
                            const included = Object.keys(newAmts).filter(k=>parseFloat(newAmts[k]||0)>0);
                            setExpForm(p=>({...p, customAmounts:newAmts, splitAmong:included}));
                          }}
                          style={{ width:85, background:"#13172a", border:`1px solid ${active?mColor(m.name,displayMembers):"#2a3060"}`, borderRadius:8, padding:"7px 9px", color:"#FFD93D", fontSize:13, fontWeight:700, outline:"none", fontFamily:"Poppins,sans-serif", textAlign:"right" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const total = Object.values(expForm.customAmounts||{}).reduce((s,a)=>s+parseFloat(a||0),0);
                const amt = parseFloat(expForm.amount||0);
                const diff = amt - total;
                const ok = Math.abs(diff) < 0.5;
                return (
                  <div style={{ background:ok?"#1a2a1a":"#1a1224", border:`1px solid ${ok?"#2ed573":"#CC5DE8"}55`, borderRadius:9, padding:"9px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:11, color:"#6a7aaa" }}>Total entered</span>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:13, fontWeight:800, color:ok?"#2ed573":"#CC5DE8" }}>{fmt(total)}</div>
                      {!ok && <div style={{ fontSize:10, color:"#CC5DE8" }}>{diff>0?`₹${diff.toFixed(2)} remaining`:`₹${Math.abs(diff).toFixed(2)} over`}</div>}
                      {ok && <div style={{ fontSize:10, color:"#2ed573" }}>✓ Matches total!</div>}
                    </div>
                  </div>
                );
              })()}
            </Field>
          )}
          <TInput label="Date" type="date" value={expForm.date||today()} onChange={e=>setExpForm(p=>({...p,date:e.target.value}))} />
          <BigBtn onClick={saveExpense} disabled={loading}>{loading?"Saving...":(editingExp?"Update Expense ✓":"Add Expense")}</BigBtn>
        </Modal>
      )}

      {/* ADD/EDIT ADVANCE MODAL */}
      {showAdv && (
        <Modal title={editingAdv ? "✏️ Edit Advance" : "💰 Record Advance"} onClose={()=>setShowAdv(false)}>
          <div style={{ background:"#1a2a1a", border:"1px solid #2ed57333", borderRadius:10, padding:"9px 12px", marginBottom:13, fontSize:11, color:"#a0e0b0", lineHeight:1.6 }}>
            Record money given before actual expense. Automatically reduces their share in settlement.
          </div>
          <Field label="Who Gave? *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {displayMembers.map(m=><Pill key={m.uid||m.id} active={advForm.from===m.name} color={mColor(m.name,displayMembers)} onClick={()=>setAdvForm(p=>({...p,from:m.name}))}>{m.name}</Pill>)}
            </div>
          </Field>
          <Field label="Who Received? *">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {displayMembers.map(m=><Pill key={m.uid||m.id} active={advForm.to===m.name} color={mColor(m.name,displayMembers)} onClick={()=>setAdvForm(p=>({...p,to:m.name}))}>{m.name}</Pill>)}
            </div>
          </Field>
          <TInput label="Amount (₹) *" type="number" placeholder="0.00" value={advForm.amount||""} onChange={e=>setAdvForm(p=>({...p,amount:e.target.value}))} />
          <TInput label="Note (optional)" placeholder="e.g. For hotel booking" value={advForm.note||""} onChange={e=>setAdvForm(p=>({...p,note:e.target.value}))} />
          <TInput label="Date" type="date" value={advForm.date||today()} onChange={e=>setAdvForm(p=>({...p,date:e.target.value}))} />
          {advForm.from&&advForm.to&&advForm.amount&&advForm.from!==advForm.to && (
            <div style={{ background:"#1e2442", borderRadius:9, padding:"8px 12px", marginBottom:12, fontSize:12, color:"#c0d0ff", textAlign:"center" }}>
              <span style={{ color:mColor(advForm.from,displayMembers), fontWeight:700 }}>{advForm.from}</span>
              <span style={{ color:"#6a7aaa" }}> gave </span>
              <span style={{ color:"#FFD93D", fontWeight:700 }}>{fmt(parseFloat(advForm.amount||0))}</span>
              <span style={{ color:"#6a7aaa" }}> to </span>
              <span style={{ color:mColor(advForm.to,displayMembers), fontWeight:700 }}>{advForm.to}</span>
            </div>
          )}
          <BigBtn onClick={saveAdvance} grad="linear-gradient(135deg,#FFD93D,#FF922B)" disabled={loading}>{loading?"Saving...":(editingAdv?"Update Advance ✓":"Record Advance 💰")}</BigBtn>
        </Modal>
      )}

      {/* ADD GROUP MODAL */}
      {showGroup && (
        <Modal title="🗂 New Group" onClose={()=>setShowGroup(false)}>
          <TInput label="Group Name" placeholder="e.g. Goa Trip 🏖️" value={newGroup} onChange={e=>setNewGroup(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createGroup()} />
          <BigBtn onClick={createGroup} grad="linear-gradient(135deg,#FF6B6B,#FF922B)" disabled={loading}>{loading?"Creating...":"Create Group 🚀"}</BigBtn>
        </Modal>
      )}

      <div style={{ textAlign:"center", padding:"16px 0 6px", color:"#1e2442", fontSize:10 }}>
        {isGuest ? "💾 Guest mode · data on this device only" : "☁️ Cloud sync enabled · tap Exit to sign out"}
      </div>

      <style>{`
        @keyframes slideDown { from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)} }
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
        *{-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1e2442;border-radius:2px}
      `}</style>
    </div>
  );
}
