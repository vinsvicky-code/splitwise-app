import { useState, useEffect } from "react";

// ── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const avatar = (name) => name?.slice(0, 2).toUpperCase() || "??";
const COLORS = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF922B","#CC5DE8","#20C997","#F06595","#74C0FC","#A9E34B"];
const memberColor = (name, members) => {
  const idx = members.findIndex(m => m.name === name);
  return COLORS[idx % COLORS.length];
};

// ── Settle Up Logic ───────────────────────────────────────────────────────────
function computeBalances(members, expenses) {
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
  return bal;
}

function computeSettlements(balances) {
  const debtors = [], creditors = [];
  Object.entries(balances).forEach(([name, amt]) => {
    if (amt < -0.01) debtors.push({ name, amt });
    if (amt > 0.01) creditors.push({ name, amt });
  });
  const settlements = [];
  let i = 0, j = 0;
  const d = debtors.map(x => ({ ...x }));
  const c = creditors.map(x => ({ ...x }));
  while (i < d.length && j < c.length) {
    const pay = Math.min(-d[i].amt, c[j].amt);
    settlements.push({ from: d[i].name, to: c[j].name, amount: pay });
    d[i].amt += pay;
    c[j].amt -= pay;
    if (Math.abs(d[i].amt) < 0.01) i++;
    if (Math.abs(c[j].amt) < 0.01) j++;
  }
  return settlements;
}

const CATEGORIES = [
  { id: "food", label: "Food & Drinks", icon: "🍔" },
  { id: "travel", label: "Travel", icon: "✈️" },
  { id: "stay", label: "Stay", icon: "🏨" },
  { id: "fuel", label: "Fuel", icon: "⛽" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "entertainment", label: "Entertainment", icon: "🎬" },
  { id: "utilities", label: "Utilities", icon: "💡" },
  { id: "other", label: "Other", icon: "📦" },
];

// ── Seed Data ──────────────────────────────────────────────────────────────
const seedMembers = [
  { id: uid(), name: "Arjun" },
  { id: uid(), name: "Priya" },
  { id: uid(), name: "Rohan" },
  { id: uid(), name: "Sneha" },
];
const seedExpenses = [
  { id: uid(), description: "Goa Hotel", amount: 8400, paidBy: "Arjun", splitAmong: ["Arjun","Priya","Rohan","Sneha"], category: "stay", date: "2025-03-01", notes: "" },
  { id: uid(), description: "Flight Tickets", amount: 14000, paidBy: "Priya", splitAmong: ["Arjun","Priya","Rohan","Sneha"], category: "travel", date: "2025-03-01", notes: "" },
  { id: uid(), description: "Beach Shack Dinner", amount: 3200, paidBy: "Rohan", splitAmong: ["Arjun","Priya","Rohan"], category: "food", date: "2025-03-02", notes: "" },
  { id: uid(), description: "Scuba Diving", amount: 6000, paidBy: "Sneha", splitAmong: ["Priya","Rohan","Sneha"], category: "entertainment", date: "2025-03-02", notes: "" },
];

// ── Components ────────────────────────────────────────────────────────────────
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,20,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: "#13172a", border: "1px solid #2a3060", borderRadius: 20, padding: "28px 24px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#f0f4ff", fontFamily: "Poppins, sans-serif" }}>{title}</span>
          <button onClick={onClose} style={{ background: "#1e2442", border: "none", borderRadius: 8, width: 32, height: 32, color: "#6a7aaa", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div style={{ fontSize: 11, color: "#6a7aaa", letterSpacing: 1, marginBottom: 6, fontFamily: "Poppins, sans-serif", textTransform: "uppercase" }}>{label}</div>}
      <input {...props} style={{ width: "100%", background: "#0d1124", border: "1px solid #2a3060", borderRadius: 10, padding: "10px 14px", color: "#f0f4ff", fontSize: 14, outline: "none", fontFamily: "Poppins, sans-serif", boxSizing: "border-box", ...props.style }} />
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function SplitApp() {
  const [groups, setGroups] = useState([{ id: uid(), name: "Goa Trip 🏖️", members: seedMembers, expenses: seedExpenses, createdAt: new Date().toLocaleDateString() }]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [tab, setTab] = useState("expenses");
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [settledTxns, setSettledTxns] = useState([]);
  const [toast, setToast] = useState(null);

  // Add expense form state
  const [form, setForm] = useState({ description: "", amount: "", paidBy: "", category: "food", date: new Date().toISOString().slice(0, 10), notes: "", splitAmong: [] });
  const [newMember, setNewMember] = useState("");
  const [newGroup, setNewGroup] = useState("");

  const group = groups[activeGroup];
  const members = group?.members || [];
  const expenses = group?.expenses || [];
  const balances = computeBalances(members, expenses);
  const settlements = computeSettlements(balances);
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const openAddExpense = () => {
    setForm({ description: "", amount: "", paidBy: members[0]?.name || "", category: "food", date: new Date().toISOString().slice(0, 10), notes: "", splitAmong: members.map(m => m.name) });
    setShowAddExpense(true);
  };

  const addExpense = () => {
    if (!form.description || !form.amount || !form.paidBy || form.splitAmong.length === 0) { showToast("Fill all required fields!", "error"); return; }
    const exp = { id: uid(), ...form, amount: parseFloat(form.amount) };
    setGroups(prev => prev.map((g, i) => i === activeGroup ? { ...g, expenses: [exp, ...g.expenses] } : g));
    setShowAddExpense(false);
    showToast(`"${form.description}" added!`);
  };

  const deleteExpense = (id) => {
    setGroups(prev => prev.map((g, i) => i === activeGroup ? { ...g, expenses: g.expenses.filter(e => e.id !== id) } : g));
    showToast("Expense removed", "warn");
  };

  const addMember = () => {
    if (!newMember.trim()) return;
    const m = { id: uid(), name: newMember.trim() };
    setGroups(prev => prev.map((g, i) => i === activeGroup ? { ...g, members: [...g.members, m] } : g));
    setNewMember("");
    setShowAddMember(false);
    showToast(`${m.name} added to group!`);
  };

  const addGroup = () => {
    if (!newGroup.trim()) return;
    setGroups(prev => [...prev, { id: uid(), name: newGroup.trim(), members: [], expenses: [], createdAt: new Date().toLocaleDateString() }]);
    setActiveGroup(groups.length);
    setNewGroup("");
    setShowAddGroup(false);
    showToast("New group created!");
  };

  const markSettled = (txn) => {
    setSettledTxns(prev => [...prev, txn.from + "->" + txn.to]);
    showToast(`${txn.from} → ${txn.to} marked settled ✓`);
  };

  const toggleSplit = (name) => {
    setForm(prev => ({ ...prev, splitAmong: prev.splitAmong.includes(name) ? prev.splitAmong.filter(n => n !== name) : [...prev.splitAmong, name] }));
  };

  const myBalance = (name) => balances[name] || 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c16", fontFamily: "Poppins, sans-serif", color: "#f0f4ff", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 80 }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "error" ? "#ff4757ee" : toast.type === "warn" ? "#ffa502ee" : "#2ed573ee", borderRadius: 12, padding: "10px 20px", fontSize: 13, color: "#fff", fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", whiteSpace: "nowrap", animation: "slideDown 0.3s ease" }}>
          {toast.type === "success" ? "✓ " : toast.type === "error" ? "✗ " : "⚠ "}{toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1f3a 0%, #0f1226 100%)", padding: "20px 20px 0", borderBottom: "1px solid #1e2442" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg, #FF6B6B, #FFD93D)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✂</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>SplitSaathi</div>
              <div style={{ fontSize: 10, color: "#6a7aaa", letterSpacing: 1 }}>EXPENSE SPLITTER</div>
            </div>
          </div>
          <button onClick={() => setShowAddGroup(true)} style={{ background: "#1e2442", border: "1px solid #2a3060", borderRadius: 10, padding: "7px 14px", color: "#4D96FF", fontSize: 12, cursor: "pointer", fontWeight: 600, fontFamily: "Poppins, sans-serif" }}>+ Group</button>
        </div>

        {/* Group Tabs */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 1 }}>
          {groups.map((g, i) => (
            <button key={g.id} onClick={() => { setActiveGroup(i); setTab("expenses"); }} style={{ background: activeGroup === i ? "#4D96FF" : "transparent", border: activeGroup === i ? "none" : "1px solid #2a3060", borderRadius: "10px 10px 0 0", padding: "8px 16px", color: activeGroup === i ? "#fff" : "#6a7aaa", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", fontWeight: activeGroup === i ? 700 : 400, fontFamily: "Poppins, sans-serif", transition: "all 0.2s" }}>
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ background: "#0f1226", padding: "14px 20px", display: "flex", gap: 12 }}>
        {[
          { label: "Total Spent", value: fmt(totalSpent), color: "#f0f4ff" },
          { label: "Members", value: members.length, color: "#4D96FF" },
          { label: "Expenses", value: expenses.length, color: "#FFD93D" },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, background: "#13172a", borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#6a7aaa", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Nav Tabs */}
      <div style={{ display: "flex", background: "#0f1226", borderBottom: "1px solid #1e2442", padding: "0 20px" }}>
        {[
          { id: "expenses", label: "Expenses", icon: "📋" },
          { id: "balances", label: "Balances", icon: "⚖️" },
          { id: "settle", label: "Settle Up", icon: "💸" },
          { id: "members", label: "Members", icon: "👥" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #4D96FF" : "2px solid transparent", padding: "12px 4px", color: tab === t.id ? "#4D96FF" : "#6a7aaa", fontSize: 11, cursor: "pointer", fontWeight: tab === t.id ? 700 : 400, fontFamily: "Poppins, sans-serif", transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: "16px 16px" }}>

        {/* EXPENSES TAB */}
        {tab === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#6a7aaa" }}>{expenses.length} expense{expenses.length !== 1 ? "s" : ""}</span>
              <button onClick={openAddExpense} style={{ background: "linear-gradient(135deg, #4D96FF, #6C63FF)", border: "none", borderRadius: 12, padding: "9px 18px", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins, sans-serif", boxShadow: "0 4px 16px #4D96FF44" }}>+ Add Expense</button>
            </div>
            {expenses.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 0", color: "#3a4470" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🧾</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No expenses yet</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>Add your first expense!</div>
              </div>
            ) : (
              expenses.map(exp => {
                const cat = CATEGORIES.find(c => c.id === exp.category);
                const perPerson = (exp.amount / exp.splitAmong.length).toFixed(2);
                return (
                  <div key={exp.id} style={{ background: "#13172a", border: "1px solid #1e2442", borderRadius: 16, padding: "14px 16px", marginBottom: 10, display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: "#1e2442", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{cat?.icon || "📦"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{exp.description}</div>
                          <div style={{ fontSize: 11, color: "#6a7aaa", marginTop: 2 }}>{exp.date} · Paid by <span style={{ color: memberColor(exp.paidBy, members) }}>{exp.paidBy}</span></div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "#FFD93D" }}>{fmt(exp.amount)}</div>
                          <div style={{ fontSize: 10, color: "#6a7aaa" }}>{fmt(perPerson)}/person</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {exp.splitAmong.map(name => (
                            <div key={name} style={{ background: memberColor(name, members) + "22", border: `1px solid ${memberColor(name, members)}44`, borderRadius: 6, padding: "2px 7px", fontSize: 10, color: memberColor(name, members), fontWeight: 600 }}>{name}</div>
                          ))}
                        </div>
                        <button onClick={() => deleteExpense(exp.id)} style={{ background: "#ff475722", border: "none", borderRadius: 6, padding: "2px 8px", color: "#ff4757", fontSize: 11, cursor: "pointer", fontFamily: "Poppins" }}>✕</button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* BALANCES TAB */}
        {tab === "balances" && (
          <div>
            <div style={{ fontSize: 13, color: "#6a7aaa", marginBottom: 14 }}>Who owes what</div>
            {members.map(m => {
              const bal = myBalance(m.name);
              const isOwed = bal > 0.01;
              const owes = bal < -0.01;
              return (
                <div key={m.id} style={{ background: "#13172a", border: `1px solid ${isOwed ? "#2ed57344" : owes ? "#ff475744" : "#1e2442"}`, borderRadius: 16, padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={m.name} members={members} size={44} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "#6a7aaa", marginTop: 2 }}>
                      {isOwed ? "gets back" : owes ? "owes" : "is settled up"}
                    </div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: isOwed ? "#2ed573" : owes ? "#ff4757" : "#6a7aaa" }}>
                    {isOwed ? "+" : owes ? "-" : ""}{Math.abs(bal) > 0.01 ? fmt(bal) : "₹0"}
                  </div>
                </div>
              );
            })}

            {/* Spending breakdown */}
            <div style={{ marginTop: 20, marginBottom: 10, fontSize: 13, color: "#6a7aaa" }}>Spending by category</div>
            {CATEGORIES.map(cat => {
              const total = expenses.filter(e => e.category === cat.id).reduce((s, e) => s + e.amount, 0);
              if (!total) return null;
              const pct = (total / totalSpent) * 100;
              return (
                <div key={cat.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12 }}>{cat.icon} {cat.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#FFD93D" }}>{fmt(total)}</span>
                  </div>
                  <div style={{ background: "#1e2442", borderRadius: 4, height: 6 }}>
                    <div style={{ width: pct + "%", background: "linear-gradient(90deg, #4D96FF, #6C63FF)", borderRadius: 4, height: "100%", transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SETTLE UP TAB */}
        {tab === "settle" && (
          <div>
            <div style={{ fontSize: 13, color: "#6a7aaa", marginBottom: 14 }}>Minimum transactions to settle all debts</div>
            {settlements.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#3a4470" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#2ed573" }}>All settled up!</div>
                <div style={{ fontSize: 12, color: "#6a7aaa", marginTop: 6 }}>No pending payments</div>
              </div>
            ) : (
              settlements.map((s, i) => {
                const key = s.from + "->" + s.to;
                const done = settledTxns.includes(key);
                return (
                  <div key={i} style={{ background: done ? "#13172a" : "#13172a", border: `1px solid ${done ? "#2ed57344" : "#2a3060"}`, borderRadius: 16, padding: "16px", marginBottom: 10, opacity: done ? 0.5 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <Avatar name={s.from} members={members} size={40} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#6a7aaa" }}>needs to pay</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#FF6B6B" }}>{fmt(s.amount)}</div>
                      </div>
                      <div style={{ fontSize: 22, color: "#4D96FF" }}>→</div>
                      <Avatar name={s.to} members={members} size={40} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: memberColor(s.from, members), fontWeight: 700 }}>{s.from}</span>
                        <span style={{ color: "#6a7aaa" }}> pays </span>
                        <span style={{ color: memberColor(s.to, members), fontWeight: 700 }}>{s.to}</span>
                      </div>
                      {!done ? (
                        <button onClick={() => markSettled(s)} style={{ background: "linear-gradient(135deg, #2ed573, #1abc9c)", border: "none", borderRadius: 10, padding: "7px 16px", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins" }}>Mark Settled ✓</button>
                      ) : (
                        <span style={{ fontSize: 12, color: "#2ed573", fontWeight: 700 }}>✓ Settled</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* MEMBERS TAB */}
        {tab === "members" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#6a7aaa" }}>{members.length} member{members.length !== 1 ? "s" : ""}</span>
              <button onClick={() => setShowAddMember(true)} style={{ background: "linear-gradient(135deg, #6C63FF, #4D96FF)", border: "none", borderRadius: 12, padding: "9px 18px", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins" }}>+ Add Member</button>
            </div>
            {members.map(m => {
              const bal = myBalance(m.name);
              const spent = expenses.filter(e => e.paidBy === m.name).reduce((s, e) => s + e.amount, 0);
              return (
                <div key={m.id} style={{ background: "#13172a", border: "1px solid #1e2442", borderRadius: 16, padding: "14px 16px", marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
                  <Avatar name={m.name} members={members} size={48} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "#6a7aaa", marginTop: 2 }}>Paid {fmt(spent)} total</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: bal > 0.01 ? "#2ed573" : bal < -0.01 ? "#ff4757" : "#6a7aaa" }}>
                      {bal > 0.01 ? "+" : ""}{Math.abs(bal) > 0.01 ? fmt(bal) : "₹0"}
                    </div>
                    <div style={{ fontSize: 10, color: "#6a7aaa" }}>{bal > 0.01 ? "gets back" : bal < -0.01 ? "owes" : "settled"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      {tab === "expenses" && (
        <button onClick={openAddExpense} style={{ position: "fixed", bottom: 24, right: 24, width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #4D96FF, #6C63FF)", border: "none", color: "#fff", fontSize: 26, cursor: "pointer", boxShadow: "0 6px 20px #4D96FF66", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>+</button>
      )}

      {/* Add Expense Modal */}
      {showAddExpense && (
        <Modal title="Add Expense" onClose={() => setShowAddExpense(false)}>
          <Input label="Description *" placeholder="e.g. Hotel booking" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          <Input label="Amount (₹) *" type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#6a7aaa", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Category</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setForm(p => ({ ...p, category: c.id }))} style={{ background: form.category === c.id ? "#4D96FF" : "#1e2442", border: form.category === c.id ? "none" : "1px solid #2a3060", borderRadius: 8, padding: "5px 10px", color: form.category === c.id ? "#fff" : "#6a7aaa", fontSize: 11, cursor: "pointer", fontFamily: "Poppins" }}>{c.icon} {c.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#6a7aaa", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Paid By *</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {members.map(m => (
                <button key={m.id} onClick={() => setForm(p => ({ ...p, paidBy: m.name }))} style={{ background: form.paidBy === m.name ? memberColor(m.name, members) : "#1e2442", border: form.paidBy === m.name ? "none" : "1px solid #2a3060", borderRadius: 8, padding: "6px 12px", color: form.paidBy === m.name ? "#fff" : "#6a7aaa", fontSize: 12, cursor: "pointer", fontFamily: "Poppins", fontWeight: form.paidBy === m.name ? 700 : 400 }}>{m.name}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#6a7aaa", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Split Among *</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {members.map(m => (
                <button key={m.id} onClick={() => toggleSplit(m.name)} style={{ background: form.splitAmong.includes(m.name) ? memberColor(m.name, members) + "44" : "#1e2442", border: `1px solid ${form.splitAmong.includes(m.name) ? memberColor(m.name, members) : "#2a3060"}`, borderRadius: 8, padding: "6px 12px", color: form.splitAmong.includes(m.name) ? memberColor(m.name, members) : "#6a7aaa", fontSize: 12, cursor: "pointer", fontFamily: "Poppins", fontWeight: 600 }}>
                  {form.splitAmong.includes(m.name) ? "✓ " : ""}{m.name}
                </button>
              ))}
            </div>
            {form.splitAmong.length > 0 && form.amount && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#FFD93D", fontWeight: 600 }}>
                ₹{(parseFloat(form.amount || 0) / form.splitAmong.length).toFixed(2)} per person
              </div>
            )}
          </div>
          <Input label="Date" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          <button onClick={addExpense} style={{ width: "100%", background: "linear-gradient(135deg, #4D96FF, #6C63FF)", border: "none", borderRadius: 12, padding: "13px", color: "#fff", fontSize: 15, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins", boxShadow: "0 4px 16px #4D96FF44" }}>Add Expense</button>
        </Modal>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <Modal title="Add Member" onClose={() => setShowAddMember(false)}>
          <Input label="Name" placeholder="Enter name" value={newMember} onChange={e => setNewMember(e.target.value)} onKeyDown={e => e.key === "Enter" && addMember()} />
          <button onClick={addMember} style={{ width: "100%", background: "linear-gradient(135deg, #6C63FF, #4D96FF)", border: "none", borderRadius: 12, padding: "13px", color: "#fff", fontSize: 15, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins" }}>Add to Group</button>
        </Modal>
      )}

      {/* Add Group Modal */}
      {showAddGroup && (
        <Modal title="New Group" onClose={() => setShowAddGroup(false)}>
          <Input label="Group Name" placeholder="e.g. Manali Trip 🏔️" value={newGroup} onChange={e => setNewGroup(e.target.value)} onKeyDown={e => e.key === "Enter" && addGroup()} />
          <button onClick={addGroup} style={{ width: "100%", background: "linear-gradient(135deg, #FF6B6B, #FF922B)", border: "none", borderRadius: 12, padding: "13px", color: "#fff", fontSize: 15, cursor: "pointer", fontWeight: 700, fontFamily: "Poppins" }}>Create Group</button>
        </Modal>
      )}

      <style>{`
        @keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
        * { -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: #1e2442; border-radius: 2px; }
      `}</style>
    </div>
  );
}
