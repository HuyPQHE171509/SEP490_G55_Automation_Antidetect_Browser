import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import PageHeader from '../../components/PageHeader';
import { useAdminApi } from '../../hooks/useAdminApi';
import toast from 'react-hot-toast';

export default function Users() {
  const { getUsers } = useAdminApi();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPro, setFilterPro] = useState(false);

  useEffect(() => {
    async function load() {
      // 1. Load users from backend (Firebase Auth Admin + Orders)
      let authUsers = [];
      try {
        const backendData = await getUsers();
        authUsers = backendData.users || [];
      } catch (err) {
        console.warn('Failed to load users from backend', err);
      }

      // 2. Load users from Firestore directly (to get roles and display names)
      const firestoreMap = {};
      try {
        const snap = await getDocs(collection(db, 'users'));
        snap.docs.forEach(d => {
          const data = d.data();
          if (data.email) {
            firestoreMap[data.email.toLowerCase()] = {
              uid: d.id,
              ...data
            };
          }
        });
      } catch (err) {
        console.warn('Failed to load users from firestore', err);
      }

      // 3. Merge them
      const mergedMap = new Map();
      
      // Add auth users first (this guarantees all registered users show up)
      for (const u of authUsers) {
        if (!u.email) continue;
        const email = u.email.toLowerCase();
        const fsUser = firestoreMap[email] || {};
        mergedMap.set(email, {
          uid: u.uid || fsUser.uid,
          email: u.email,
          displayName: u.displayName || fsUser.displayName || null,
          role: fsUser.role || 'user',
          provider: u.provider || fsUser.provider || 'local',
          emailVerified: u.emailVerified || fsUser.emailVerified || false,
          createdAt: u.createdAt || fsUser.createdAt || null,
          lastSignIn: u.lastSignIn || fsUser.lastSignIn || null,
          isPro: u.isPro || false,
          isTrial: u.isTrial || false,
        });
      }

      // Add any stray firestore users that aren't in Auth (rare but possible)
      for (const [email, fsUser] of Object.entries(firestoreMap)) {
        if (!mergedMap.has(email)) {
          mergedMap.set(email, {
            uid: fsUser.uid,
            email: fsUser.email,
            displayName: fsUser.displayName || null,
            role: fsUser.role || 'user',
            provider: fsUser.provider || 'local',
            emailVerified: fsUser.emailVerified || false,
            createdAt: fsUser.createdAt || null,
            lastSignIn: fsUser.lastSignIn || null,
            isPro: false,
            isTrial: false,
          });
        }
      }

      const finalUsers = Array.from(mergedMap.values());

      // Sort: admin first, then by createdAt desc
      finalUsers.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      setUsers(finalUsers);
    }

    load()
      .catch(err => toast.error('Failed to load users: ' + err.message))
      .finally(() => setLoading(false));
  }, []);

  const visible = users.filter(u => {
    const matchSearch =
      !search ||
      (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.displayName || '').toLowerCase().includes(search.toLowerCase());
    const matchPro = !filterPro || u.isPro;
    return matchSearch && matchPro;
  });

  const trialCount = users.filter(u => u.isTrial).length;
  const paidCount  = users.filter(u => u.isPro && !u.isTrial).length;
  const adminCount = users.filter(u => u.role === 'admin').length;

  return (
    <>
      <PageHeader title="Users" description="Account list" />

      {!loading && users.length > 0 && (
        <div className="flex flex-wrap gap-4 mb-6">
          {[
            { label: 'Total users', value: users.length, color: 'text-slate-700 dark:text-slate-200' },
            { label: '🛡 Admin',    value: adminCount,   color: 'text-violet-400' },
            { label: '🚀 Trial',   value: trialCount,   color: 'text-cyan-400' },
            { label: '⚡ Paid',    value: paidCount,    color: 'text-amber-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-2 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5">
              <span className="text-xs text-slate-400">{label}</span>
              <span className={`text-base font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search email or name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-primary w-64"
        />
        <button
          onClick={() => setFilterPro(v => !v)}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${filterPro ? 'bg-amber-500 text-black border-amber-500' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-400'}`}
        >
          ⚡ Pro & Trial
        </button>
        <span className="ml-auto text-xs text-slate-400 self-center">{visible.length} user</span>
      </div>

      <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading...</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No users found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Email', 'Name', 'Role', 'License', 'Provider', 'Registered', 'Last login'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {visible.map((u, i) => (
                <tr key={u.uid || i} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    <span>{u.email || '—'}</span>
                    {!u.emailVerified && u.email && (
                      <span className="ml-1.5 text-xs text-amber-400" title="Email not verified">⚠</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.displayName || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    {u.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-violet-500/15 text-violet-400 border border-violet-500/20">
                        🛡 Admin
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">User</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.isPro && !u.isTrial && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">⚡ PRO</span>
                    )}
                    {u.isTrial && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">🚀 TRIAL</span>
                    )}
                    {!u.isPro && !u.isTrial && <span className="text-xs text-slate-400">Free</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{u.provider}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString('en-US') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
