import { useState } from "react";

// ── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const avatar = (name) => name?.slice(0, 2).toUpperCase() || "??";
const COLORS = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF922B","#CC5DE8","#20C997","#F06595","#74C0FC","#A9E34B"];
const memberColor = (name, members) => {
  const idx = members.findIndex(m => m.name === name);
  return COLORS[idx % COLORS.length];
};

// ── Balance Logic (now includes advances) ────────────────────────────────────
function computeBalances(members, expenses, advances) {
  const bal = {};
  members.forEach(m => bal[m.name] = 0);

  expenses.forEach(exp => {
    const perPerson = exp.amount / exp.splitAmong.length;
    exp.splitAmong.forEach(name => {
      if (name !== exp.paidBy) bal[name] = (bal[name] || 0) - perPerson;
    });
    const othersShare = exp.splitAmong.filter(n => n !== exp.paidBy).length * perPerson;
    bal[exp.paidBy] = (bal[exp.paidBy] || 0) + othersShare;
  });

  // Advances: "from" gave money to "to"
  advances.forEach(adv => {
    bal[adv.from] = (bal[adv.from] || 0) + adv.amount;
    bal[adv.to]   = (bal[adv.to]   || 0) - adv.amount;
  });

  return bal;
}

function computeSettlements(balances) {
  const debtors = [], creditors = [];
  Object.entries(balances).forEach(([name, amt]) => {
    if (amt < -0.01) debtors.push({ name, amt });
    if (amt > 0.01)  creditors.push({ name, amt });
  });
  const settlements = [];
  let i = 0, j = 0;
  const d = debtors.map(x => ({ ...x }));
  const c = creditors.map(x => ({ ...x }));
  while (i < d.length && j < c.length) {
    const pay = Math.min(-d[i].amt, c[j].amt);
    settlements.push({ from: d[i].name, to: c[j].name, amount: pay });
    d[i].amt += pay; c[j].amt -= pay;
    if (Math.abs(d[i].amt) < 0.01) i++;
    if (Math.abs(c[j].amt) < 0.01) j++;
  }
  return settlements;
}

const CATEGORIES = [
  { id: "food",          label: "Food & Drinks",  icon: "🍔" },
  { id: "travel",        label: "Travel",          icon: "✈️" },
  { id: "stay",          label: "Stay",            icon: "🏨" },
  { id: "fuel",          label: "Fuel",            icon: "⛽" },
  { id: "shopping",      label: "Shopping",        icon: "🛍️" },
  { id: "entertainment", label: "Entertainment",   icon: "🎬" },
  { id: "utilities",     label: "Utilities",       icon: "💡" },
  { id: "other",         label: "Other",           icon: "📦" },
];

const seedMembers  = [
  { id: uid(), name: "Arjun" },
  { id: uid(), name: "Priya" },
  { id: uid(), name: "Rohan" },
  { id: uid(), name: "Sneha" },
];
const seedExpenses = [
  { id: uid(), description: "Goa Hotel",         amount: 8400,  paidBy: "Arjun", splitAmong: ["Arjun","Priya","Rohan","Sneha"], category: "stay",          date: "2025-03-01" },
  { id: uid(), description: "Flight Tickets",    amount: 14000, paidBy: "Priya", splitAmong: ["Arjun","Priya","Rohan","Sneha"], category: "travel",        date: "2025-03-01" },
  { id: uid(), description: "Beach Shack Dinner",amount: 3200,  paidBy: "Rohan", splitAmong: ["Arjun","Priya","Rohan"],         category: "food",          date: "2025-03-02" },
  { id: uid(), description: "Scuba Diving",      amount: 6000,  paidBy: "Sneha", splitAmong: ["Priya","Rohan","Sneha"],         category: "entertainment", date: "2025-03-02" },
];
const seedAdvances = [
  { id: uid(), from: "Rohan", to: "Arjun", amount: 2000, note: "Trip advance for booking", date: "2025-02-28" },
];

// ── Reusable UI ───────────────────────────────────────────────────────────────
function Avatar({ name, size = 36, members }) {
  const color = memberColor(name, members);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color + "33", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color, flexShrink: 0, fontFamily: "Poppins, sans-serif" }}>
      {avatar(name)}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,20,0.88)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: "#13172a", border: "1px solid #2a3060", borderRadius: 20, padding: "28px 24px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#f0f4ff", fontFamily: "Poppins, sans-serif" }}>{title}</span>
          <button onClick={onClose} style={{ background: "#1e2442", border: "none", borderRadius: 8, width: 32, height: 32, color: "#6a7aaa", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#6a7aaa", letterSpacing: 1, marginBottom: 7, textTransform: "uppercase", fontFamily: "Poppins" }}>{label}</div>
      {children}
    </div>
  );
}

function TextInput({ label, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div style={{ fontSize: 11, color: "#6a7aaa", letterSpacing: 1, marginBottom: 6, fontFamily: "Poppins", textTransform: "uppercase" }}>{label}</div>}
      <input {...props} style={{ width: "100%", background: "#0d1124", border: "1px solid #2a3060", borderRadius: 10, padding: "10px 14px", color: "#f0f4ff", fontSize: 14, outline: "none", fontFamily: "Poppins", boxSizing: "border-box", ...props.style }} />
    </div>
  );
}

function PillBtn({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: active ? (color || "#4D96FF") : "#1e2442", border: active ? "none" : "1px solid #2a3060", borderRadius: 8, padding: "6px 13px", color: active ? "#fff" : "#6a7aaa", fontSize: 12, cursor: "pointer", fontFamily: "Poppins", fontWeight: active ? 700 : 400, transition: "all 0.15s" }}>
      {children}
    </button>
  );
}

function Btn({ children, onClick, gradient = "linear-gradient(135deg,#4D96FF,#6C63FF)", style = {} }) {
  return (
    <button onClick={onClick} style={{ width: "100%", background: gradient, border: "none", borderRadius: 12, padding: "13px", color: "#fff", fontSize: 15, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins", ...style }}>
      {children}
    </button>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function SplitApp() {
  const [groups, setGroups] = useState([{
    id: uid(), name: "Goa Trip 🏖️",
    members: seedMembers, expenses: seedExpenses, advances: seedAdvances,
    createdAt: new Date().toLocaleDateString()
  }]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [tab, setTab]     = useState("expenses");
  const [toast, setToast] = useState(null);
  const [settledTxns, setSettledTxns] = useState([]);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddAdvance, setShowAddAdvance] = useState(false);
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [showAddGroup,   setShowAddGroup]   = useState(false);

  const today = () => new Date().toISOString().slice(0, 10);

  const group    = groups[activeGroup] || groups[0];
  const members  = group.members;
  const expenses = group.expenses;
  const advances = group.advances || [];

  const blankExpense = () => ({ description: "", amount: "", paidBy: members[0]?.name || "", category: "food", date: today(), splitAmong: members.map(m => m.name) });
  const blankAdvance = () => ({ from: members[0]?.name || "", to: members[1]?.name || "", amount: "", note: "", date: today() });

  const [expForm,    setExpForm]    = useState(blankExpense());
  const [advForm,    setAdvForm]    = useState(blankAdvance());
  const [newMember,  setNewMember]  = useState("");
  const [newGroup,   setNewGroup]   = useState("");

  const balances    = computeBalances(members, expenses, advances);
  const settlements = computeSettlements(balances);
  const totalSpent  = expenses.reduce((s, e) => s + e.amount, 0);
  const totalAdv    = advances.reduce((s, a) => s + a.amount, 0);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };
  const updateGroup = (fn) => setGroups(prev => prev.map((g, i) => i === activeGroup ? fn(g) : g));

  const addExpense = () => {
    if (!expForm.description || !expForm.amount || !expForm.paidBy || expForm.splitAmong.length === 0)
      return showToast("Fill all required fields!", "error");
    updateGroup(g => ({ ...g, expenses: [{ id: uid(), ...expForm, amount: parseFloat(expForm.amount) }, ...g.expenses] }));
    setShowAddExpense(false); showToast(`"${expForm.description}" added!`);
  };

  const deleteExpense = (id) => { updateGroup(g => ({ ...g, expenses: g.expenses.filter(e => e.id !== id) })); showToast("Expense removed", "warn"); };

  const addAdvance = () => {
    if (!advForm.from || !advForm.to || !advForm.amount) return showToast("Fill all fields!", "error");
    if (advForm.from === advForm.to) return showToast("From and To can't be the same!", "error");
    updateGroup(g => ({ ...g, advances: [{ id: uid(), ...advForm, amount: parseFloat(advForm.amount) }, ...(g.advances || [])] }));
    setShowAddAdvance(false); showToast(`Advance of ${fmt(parseFloat(advForm.amount))} recorded!`);
  };

  const deleteAdvance = (id) => { updateGroup(g => ({ ...g, advances: (g.advances || []).filter(a => a.id !== id) })); showToast("Advance removed", "warn"); };

  const addMember = () => {
    if (!newMember.trim()) return;
    updateGroup(g => ({ ...g, members: [...g.members, { id: uid(), name: newMember.trim() }] }));
    setNewMember(""); setShowAddMember(false); showToast(`${newMember.trim()} added!`);
  };

  const addGroup = () => {
    if (!newGroup.trim()) return;
    setGroups(prev => [...prev, { id: uid(), name: newGroup.trim(), members: [], expenses: [], advances: [], createdAt: new Date().toLocaleDateString() }]);
    setActiveGroup(groups.length); setNewGroup(""); setShowAddGroup(false); showToast("New group created!");
  };

  const markSettled = (txn) => { setSettledTxns(prev => [...prev, txn.from + "->" + txn.to]); showToast(`${txn.from} → ${txn.to} marked settled ✓`); };
  const openAddExpense = () => { setExpForm(blankExpense()); setShowAddExpense(true); };
  const openAddAdvance = () => { setAdvForm(blankAdvance()); setShowAddAdvance(true); };
  const toggleSplit = (name) => setExpForm(p => ({ ...p, splitAmong: p.splitAmong.includes(name) ? p.splitAmong.filter(n => n !== name) : [...p.splitAmong, name] }));

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c16", fontFamily: "Poppins, sans-serif", color: "#f0f4ff", maxWidth: 480, margin: "0 auto", paddingBottom: 90 }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "error" ? "#ff4757ee" : toast.type === "warn" ? "#ffa502ee" : "#2ed573ee", borderRadius: 12, padding: "10px 22px", fontSize: 13, color: "#fff", fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", whiteSpace: "nowrap", animation: "slideDown 0.3s ease" }}>
          {toast.type === "success" ? "✓ " : toast.type === "error" ? "✗ " : "⚠ "}{toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1a1f3a 0%,#0f1226 100%)", padding: "20px 20px 0", borderBottom: "1px solid #1e2442" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg,#FF6B6B,#FFD93D)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✂</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>SplitSaathi</div>
              <div style={{ fontSize: 10, color: "#6a7aaa", letterSpacing: 1 }}>EXPENSE SPLITTER</div>
            </div>
          </div>
          <button onClick={() => setShowAddGroup(true)} style={{ background: "#1e2442", border: "1px solid #2a3060", borderRadius: 10, padding: "7px 14px", color: "#4D96FF", fontSize: 12, cursor: "pointer", fontWeight: 600, fontFamily: "Poppins" }}>+ Group</button>
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 1 }}>
          {groups.map((g, i) => (
            <button key={g.id} onClick={() => { setActiveGroup(i); setTab("expenses"); }} style={{ background: activeGroup === i ? "#4D96FF" : "transparent", border: activeGroup === i ? "none" : "1px solid #2a3060", borderRadius: "10px 10px 0 0", padding: "8px 16px", color: activeGroup === i ? "#fff" : "#6a7aaa", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", fontWeight: activeGroup === i ? 700 : 400, fontFamily: "Poppins" }}>
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ background: "#0f1226", padding: "12px 16px", display: "flex", gap: 10, borderBottom: "1px solid #1e2442" }}>
        {[
          { label: "Total Spent", value: fmt(totalSpent), color: "#f0f4ff" },
          { label: "Advances",    value: fmt(totalAdv),   color: "#FFD93D" },
          { label: "Members",     value: members.length,  color: "#4D96FF" },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, background: "#13172a", borderRadius: 12, padding: "10px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#6a7aaa", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Nav */}
      <div style={{ display: "flex", background: "#0f1226", borderBottom: "1px solid #1e2442", padding: "0 8px" }}>
        {[
          { id: "expenses", label: "Expenses", icon: "📋" },
          { id: "advances", label: "Advances", icon: "💰" },
          { id: "balances", label: "Balances", icon: "⚖️" },
          { id: "settle",   label: "Settle",   icon: "💸" },
          { id: "members",  label: "Members",  icon: "👥" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #4D96FF" : "2px solid transparent", padding: "11px 2px", color: tab === t.id ? "#4D96FF" : "#6a7aaa", fontSize: 10, cursor: "pointer", fontWeight: tab === t.id ? 700 : 400, fontFamily: "Poppins", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 14 }}>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>

        {/* EXPENSES */}
        {tab === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#6a7aaa" }}>{expenses.length} expense{expenses.length !== 1 ? "s" : ""}</span>
              <button onClick={openAddExpense} style={{ background: "linear-gradient(135deg,#4D96FF,#6C63FF)", border: "none", borderRadius: 12, padding: "9px 18px", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins" }}>+ Add Expense</button>
            </div>
            {expenses.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 0", color: "#3a4470" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🧾</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No expenses yet</div>
              </div>
            ) : expenses.map(exp => {
              const cat = CATEGORIES.find(c => c.id === exp.category);
              return (
                <div key={exp.id} style={{ background: "#13172a", border: "1px solid #1e2442", borderRadius: 16, padding: "14px 16px", marginBottom: 10, display: "flex", gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: "#1e2442", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{cat?.icon || "📦"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{exp.description}</div>
                        <div style={{ fontSize: 11, color: "#6a7aaa", marginTop: 2 }}>{exp.date} · Paid by <span style={{ color: memberColor(exp.paidBy, members) }}>{exp.paidBy}</span></div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#FFD93D" }}>{fmt(exp.amount)}</div>
                        <div style={{ fontSize: 10, color: "#6a7aaa" }}>{fmt(exp.amount / exp.splitAmong.length)}/person</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {exp.splitAmong.map(name => (
                          <span key={name} style={{ background: memberColor(name, members) + "22", border: `1px solid ${memberColor(name, members)}44`, borderRadius: 6, padding: "2px 7px", fontSize: 10, color: memberColor(name, members), fontWeight: 600 }}>{name}</span>
                        ))}
                      </div>
                      <button onClick={() => deleteExpense(exp.id)} style={{ background: "#ff475722", border: "none", borderRadius: 6, padding: "2px 9px", color: "#ff4757", fontSize: 11, cursor: "pointer", fontFamily: "Poppins", flexShrink: 0 }}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ADVANCES */}
        {tab === "advances" && (
          <div>
            <div style={{ background: "#1a2a1a", border: "1px solid #2ed57344", borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10 }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <div style={{ fontSize: 12, color: "#a0e0b0", lineHeight: 1.7 }}>
                <b>What is an Advance?</b><br />
                Money given <b>before</b> a trip or expense. Example: Rohan gave ₹2000 to Arjun for hotel booking. This automatically adjusts final balances so nobody overpays.
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#6a7aaa" }}>{advances.length} advance{advances.length !== 1 ? "s" : ""} · {fmt(totalAdv)} total</span>
              <button onClick={openAddAdvance} style={{ background: "linear-gradient(135deg,#FFD93D,#FF922B)", border: "none", borderRadius: 12, padding: "9px 18px", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "Poppin
