import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AccessDenied } from '../components/common/AccessDenied';
import { ConfirmDialog, type ConfirmDialogVariant } from '../components/common/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { DEFAULT_OWNER_ALERT_EMAIL } from '../services/loginAlertService';
import type { EmploymentStatus, PageId, UserProfile, UserRole } from '../types';
import { formatDateTime, formatRupiah } from '../utils/format';
import { normalizeEmail } from '../utils/googleAuth';
import { getRoleDisplayLabel } from '../utils/rbac';
import { normalizeUsername, validatePassword, validateUsername } from '../utils/usernameAuth';

interface EmployeesPageProps {
  onNavigate: (page: PageId) => void;
}

type EditableCellField =
  | 'full_name'
  | 'position'
  | 'email'
  | 'phone_number'
  | 'shift'
  | 'employment_status'
  | 'monthly_salary'
  | 'join_date'
  | 'emergency_contact';

const EMPLOYMENT_STATUS_OPTIONS: EmploymentStatus[] = [
  'Tetap',
  'Kontrak',
  'Part-Time',
  'Probation',
];

const SHIFT_PRESETS = [
  'Full Access',
  'Shift Pagi (07:00 - 15:00)',
  'Shift Siang (14:00 - 22:00)',
  'Shift Sore (15:00 - 23:00)',
  'Split Shift (08:00 - 12:00 & 17:00 - 21:00)',
];

export function EmployeesPage({ onNavigate }: EmployeesPageProps) {
  const { canSeeEmployees } = useAuth();
  const {
    employees,
    employeesSyncStatus,
    employeesSyncError,
    refreshAllFromSupabase,
    settings,
    usernameLoginLogs,
    addEmployee,
    updateEmployee,
    setEmployeeCredentials,
    deleteEmployee,
    updateEmployeeRole,
  } = useStore();

  // Add employee form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('Barista & Kasir');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [shift, setShift] = useState('Shift Pagi (07:00 - 15:00)');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>('Kontrak');
  const [monthlySalary, setMonthlySalary] = useState('4200000');
  const [joinDate, setJoinDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [emergencyContact, setEmergencyContact] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Double-click inline cell edit state
  const [editingCell, setEditingCell] = useState<{
    employeeId: string;
    field: EditableCellField;
  } | null>(null);
  const [draftValue, setDraftValue] = useState<string>('');

  // Full detail modal for operational notes & username credentials
  const [detailEmployee, setDetailEmployee] = useState<UserProfile | null>(null);
  const [modalDraft, setModalDraft] = useState<Partial<UserProfile>>({});
  const [modalUsername, setModalUsername] = useState('');
  const [modalPassword, setModalPassword] = useState('');
  const [showModalPassword, setShowModalPassword] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [savingModal, setSavingModal] = useState(false);
  const [syncingEmployees, setSyncingEmployees] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Reusable confirmation dialog state for delete, role change, and edit actions
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    variant: ConfirmDialogVariant;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => Promise<void> | void;
  }>({
    open: false,
    variant: 'warning',
    title: '',
    description: '',
    confirmLabel: 'Ya, Lanjutkan',
    onConfirm: () => {},
  });
  const [confirmBusy, setConfirmBusy] = useState(false);

  const stats = useMemo(() => {
    const activeCount = employees.filter((e) => e.is_active).length;
    const totalMonthlyPayroll = employees
      .filter((e) => e.is_active)
      .reduce((sum, e) => sum + (e.monthly_salary ?? 0), 0);
    const activeOwnerCount = employees.filter((e) => e.role === 'owner' && e.is_active).length;
    const ownerCount = employees.filter((e) => e.role === 'owner').length;
    const managerCount = employees.filter((e) => e.role === 'manager').length;
    const cashierCount = employees.filter((e) => e.role === 'cashier').length;
    return {
      activeCount,
      totalMonthlyPayroll,
      activeOwnerCount,
      ownerCount,
      managerCount,
      cashierCount,
    };
  }, [employees]);

  if (!canSeeEmployees) {
    return (
      <AccessDenied
        title="Halaman Karyawan Khusus Owner"
        description="Pengelolaan akun karyawan dan hak akses role hanya tersedia untuk akun Owner."
        onNavigateBack={onNavigate}
      />
    );
  }

  const notify = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 4000);
  };

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setErrorMsg('Nama lengkap dan email karyawan wajib diisi.');
      return;
    }
    const normalizedEmail = normalizeEmail(email);
    if (employees.some((emp) => normalizeEmail(emp.email) === normalizedEmail)) {
      setErrorMsg(
        `Email "${normalizedEmail}" sudah digunakan oleh karyawan lain. Setiap karyawan harus memiliki email unik.`
      );
      return;
    }

    let normalizedUser: string | undefined;
    if (username.trim()) {
      const userCheck = validateUsername(username);
      if (!userCheck.valid) {
        setErrorMsg(userCheck.error || 'Format username tidak valid.');
        return;
      }
      normalizedUser = userCheck.normalized;
      if (
        employees.some(
          (emp) => emp.username && normalizeUsername(emp.username) === normalizedUser
        )
      ) {
        setErrorMsg(`Username "@${normalizedUser}" sudah dipakai karyawan lain.`);
        return;
      }
      const passCheck = validatePassword(password);
      if (!passCheck.valid) {
        setErrorMsg(passCheck.error || 'Kata sandi minimal 6 karakter.');
        return;
      }
    } else if (password.trim()) {
      setErrorMsg('Isi Username terlebih dahulu jika ingin menetapkan kata sandi login.');
      return;
    }

    const addRes = await addEmployee({
      full_name: fullName,
      position,
      email,
      username: normalizedUser,
      password: password.trim() || undefined,
      phone_number: phone || '-',
      role,
      shift,
      employment_status: employmentStatus,
      monthly_salary: Math.max(0, Number(monthlySalary) || 0),
      join_date: joinDate,
      emergency_contact: emergencyContact,
    });
    if (!addRes.ok) {
      setErrorMsg(
        addRes.error ||
          'Gagal menyinkronkan karyawan baru ke Supabase. Pastikan SQL employees terbaru sudah dijalankan.'
      );
      return;
    }
    setFullName('');
    setPosition('Barista & Kasir');
    setEmail('');
    setUsername('');
    setPassword('');
    setPhone('');
    setRole('cashier');
    setShift('Shift Pagi (07:00 - 15:00)');
    setEmploymentStatus('Kontrak');
    setMonthlySalary('4200000');
    setEmergencyContact('');
    setErrorMsg(null);
    setShowAddForm(false);
    notify(
      normalizedUser
        ? `Akun karyawan & login username "@${normalizedUser}" berhasil disimpan ke database.`
        : 'Akun karyawan baru berhasil disimpan ke database.'
    );
  };

  const startInlineEdit = (emp: UserProfile, field: EditableCellField) => {
    setEditingCell({ employeeId: emp.id, field });
    const rawVal = emp[field];
    setDraftValue(rawVal !== undefined && rawVal !== null ? String(rawVal) : '');
  };

  const cancelInlineEdit = () => {
    setEditingCell(null);
    setDraftValue('');
  };

  const commitInlineEdit = (emp: UserProfile, field: EditableCellField) => {
    const trimmed = draftValue.trim();
    const currentRaw = emp[field] !== undefined && emp[field] !== null ? String(emp[field]) : '';
    if (trimmed === currentRaw.trim()) {
      cancelInlineEdit();
      return;
    }
    if (field === 'full_name' && !trimmed) {
      cancelInlineEdit();
      return;
    }
    if (field === 'email') {
      if (!trimmed) {
        cancelInlineEdit();
        return;
      }
      const normalizedNext = normalizeEmail(trimmed);
      if (
        employees.some(
          (other) => other.id !== emp.id && normalizeEmail(other.email) === normalizedNext
        )
      ) {
        cancelInlineEdit();
        notify(`Email "${normalizedNext}" sudah terdaftar pada karyawan lain.`);
        return;
      }
    }

    const patch: Partial<UserProfile> =
      field === 'monthly_salary'
        ? { monthly_salary: Math.max(0, Number(draftValue.replace(/[^\d]/g, '')) || 0) }
        : field === 'employment_status'
          ? { employment_status: draftValue as EmploymentStatus }
          : { [field]: trimmed };

    setEditingCell(null);
    setDraftValue('');

    setConfirmState({
      open: true,
      variant: 'warning',
      title: 'Konfirmasi Perubahan Data Karyawan',
      description: (
        <span>
          Apakah Anda yakin ingin menyimpan perubahan data untuk{' '}
          <strong className="text-[#1A2E26]">{emp.full_name}</strong>? Perubahan akan langsung
          disinkronkan ke database.
        </span>
      ),
      confirmLabel: 'Ya, Simpan Perubahan',
      onConfirm: async () => {
        const res = await updateEmployee(emp.id, patch);
        if (!res.ok) {
          notify(res.error || 'Gagal menyimpan perubahan ke Supabase.');
        } else {
          notify(
            `Data karyawan "${field === 'full_name' ? trimmed : emp.full_name}" berhasil diperbarui.`
          );
        }
      },
    });
  };

  const handleInlineKeyDown = (
    e: React.KeyboardEvent,
    emp: UserProfile,
    field: EditableCellField
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineEdit(emp, field);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    }
  };

  const openDetailModal = (emp: UserProfile) => {
    setDetailEmployee(emp);
    setModalError(null);
    setModalUsername(emp.username ?? '');
    setModalPassword('');
    setShowModalPassword(false);
    setModalDraft({
      full_name: emp.full_name,
      position: emp.position ?? '',
      email: emp.email,
      phone_number: emp.phone_number,
      shift: emp.shift ?? '',
      employment_status: emp.employment_status ?? 'Tetap',
      monthly_salary: emp.monthly_salary ?? 0,
      join_date: emp.join_date ?? '',
      emergency_contact: emp.emergency_contact ?? '',
      notes: emp.notes ?? '',
      is_active: emp.is_active,
    });
  };

  const executeSaveDetailModal = async () => {
    if (!detailEmployee || savingModal) return;
    setModalError(null);
    setSavingModal(true);

    const updateRes = await updateEmployee(detailEmployee.id, {
      ...modalDraft,
      monthly_salary: Math.max(0, Number(modalDraft.monthly_salary) || 0),
    });

    if (!updateRes.ok) {
      setModalError(updateRes.error || 'Gagal menyimpan perubahan data karyawan ke Supabase.');
      setSavingModal(false);
      return;
    }

    const trimmedModalUser = modalUsername.trim();
    const trimmedModalPass = modalPassword.trim();
    const credentialsChanged =
      trimmedModalUser !== (detailEmployee.username ?? '') || trimmedModalPass.length > 0;

    if (credentialsChanged) {
      const credResult = await setEmployeeCredentials(
        detailEmployee.id,
        trimmedModalUser,
        trimmedModalPass || undefined
      );
      if (!credResult.ok) {
        setModalError(credResult.error || 'Gagal menyimpan username & kata sandi.');
        setSavingModal(false);
        return;
      }
    }

    setSavingModal(false);
    notify(
      credentialsChanged && trimmedModalUser
        ? `Profil & kredensial login "@${normalizeUsername(trimmedModalUser)}" disimpan.`
        : `Profil operasional "${modalDraft.full_name || detailEmployee.full_name}" disimpan.`
    );
    setDetailEmployee(null);
  };

  const handleSaveDetailModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailEmployee || savingModal) return;
    setConfirmState({
      open: true,
      variant: 'warning',
      title: 'Konfirmasi Simpan Perubahan Karyawan',
      description: (
        <span>
          Simpan perubahan data profil dan/atau kredensial login untuk{' '}
          <strong className="text-[#1A2E26]">
            {modalDraft.full_name || detailEmployee.full_name}
          </strong>
          ?
        </span>
      ),
      confirmLabel: 'Ya, Simpan Perubahan',
      onConfirm: executeSaveDetailModal,
    });
  };

  const handleManualSyncEmployees = async () => {
    setSyncingEmployees(true);
    await refreshAllFromSupabase();
    setSyncingEmployees(false);
    notify('Sinkronisasi daftar karyawan dari Supabase selesai dijalankan.');
  };

  const isCellEditing = (empId: string, field: EditableCellField) =>
    editingCell?.employeeId === empId && editingCell?.field === field;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#1A2E26]">Karyawan &amp; Hak Akses Role</h1>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#109A58]">
              <Lock className="h-3.5 w-3.5" />
              Khusus Owner
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Kelola tim barista, kasir, dan manager beserta shift kerja, gaji bulanan, status
            kepegawaian, dan kontak darurat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncingEmployees}
            onClick={() => void handleManualSyncEmployees()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-3.5 py-2 text-xs font-semibold text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58] disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingEmployees ? 'animate-spin' : ''}`} />
            <span>{syncingEmployees ? 'Menyinkronkan...' : 'Sinkronkan Supabase'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0D8A4E] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Tambah Karyawan</span>
          </button>
        </div>
      </div>

      {employeesSyncStatus === 'error' && employeesSyncError && (
        <div
          role="alert"
          data-testid="employees-sync-warning"
          className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#F59E0B]/40 bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />
            <div>
              <p className="font-semibold">
                Daftar karyawan belum tersinkron dengan tabel Supabase <code>public.employees</code>
              </p>
              <p className="mt-0.5 leading-relaxed">{employeesSyncError}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={syncingEmployees}
            onClick={() => void handleManualSyncEmployees()}
            className="rounded-full bg-[#D97706] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#B45309] whitespace-nowrap"
          >
            Coba Sinkron Lagi
          </button>
        </div>
      )}

      {/* Operational KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3.5 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-[#6B7280]">Karyawan Aktif</p>
            <p className="text-lg font-bold text-[#1A2E26] tabular-nums">
              {stats.activeCount} / {employees.length} orang
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-[#6B7280]">Estimasi Beban Gaji / Bulan</p>
            <p
              data-testid="employees-total-payroll"
              className="text-lg font-bold text-[#109A58] tabular-nums"
            >
              {formatRupiah(stats.totalMonthlyPayroll)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <p className="text-xs font-medium text-[#6B7280]">Komposisi Role Akses</p>
          <p className="mt-1 text-sm font-semibold text-[#1A2E26] tabular-nums">
            {stats.ownerCount} Owner · {stats.managerCount} Manager · {stats.cashierCount} Kasir
          </p>
          <p className="mt-0.5 text-[11px] text-[#6B7280]">RBAC aktif di seluruh modul POS</p>
        </div>
      </div>

      {toastMsg && (
        <div
          role="status"
          data-testid="employee-toast"
          className="flex items-center gap-2 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Add Employee Form */}
      {showAddForm && (
        <form
          onSubmit={handleSubmitAdd}
          className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-[#1A2E26]">Tambah Akun &amp; Data Karyawan</h2>
          {errorMsg && <p className="text-xs font-medium text-[#EF4444]">{errorMsg}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nama lengkap *"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Jabatan / Posisi (cth: Head Barista)"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email Google karyawan * (untuk Login Google)"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="No. HP / WhatsApp"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              aria-label="Role Karyawan"
              className="h-10 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              <option value="cashier">Role: Kasir</option>
              <option value="manager">Role: Manager</option>
              <option value="owner">Role: Owner</option>
            </select>
            <input
              type="text"
              list="brewflow-shift-presets"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              placeholder="Jadwal Shift"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <select
              value={employmentStatus}
              onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
              aria-label="Status Kepegawaian"
              className="h-10 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              {EMPLOYMENT_STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  Status: {st}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={monthlySalary}
              onChange={(e) => setMonthlySalary(e.target.value)}
              placeholder="Gaji Bulanan (Rp)"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs tabular-nums text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="date"
              value={joinDate}
              onChange={(e) => setJoinDate(e.target.value)}
              aria-label="Tanggal Bergabung"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="text"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder="Kontak Darurat (Nama · No. HP)"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username Login (opsional, cth: kasir.dimas)"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password Login Username (min. 6 karakter)"
              className="h-10 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="h-9 rounded-full border border-[#E5E7EB] px-4 text-xs font-semibold text-[#6B7280]"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
            >
              Simpan Karyawan
            </button>
          </div>
        </form>
      )}

      <datalist id="brewflow-shift-presets">
        {SHIFT_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>

      {/* Double-Click Inline Edit & Google OAuth Hint */}
      <div className="flex items-center gap-2 rounded-xl border border-[#109A58]/20 bg-[#E6F5EE]/60 px-4 py-2.5 text-xs text-[#1A2E26]">
        <Info className="h-4 w-4 shrink-0 text-[#109A58]" />
        <span>
          <strong>Edit Cepat &amp; Login Google:</strong> Klik dua kali (<em>double-click</em>)
          kolom Nama, Jabatan, Email, No. WA, Shift, Status, atau Gaji untuk edit langsung (
          <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold">
            Enter
          </kbd>{' '}
          simpan,{' '}
          <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold">
            Esc
          </kbd>{' '}
          batal). Alamat <strong>Email</strong> &amp; status <strong>Aktif</strong> di tabel ini
          langsung dipakai untuk verifikasi <strong>Login Google OAuth</strong>.
        </span>
      </div>

      {/* Employee Data Table with Double-Click Inline Editing */}
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 text-xs font-semibold text-[#6B7280]">
                <th className="px-3.5 py-3">Karyawan &amp; Jabatan</th>
                <th className="px-3 py-3">Email, Username &amp; WA</th>
                <th className="px-3 py-3">Shift Kerja</th>
                <th className="px-3 py-3">Status &amp; Tgl Gabung</th>
                <th className="px-3 py-3 text-right">Gaji / Bulan</th>
                <th className="px-3 py-3">Role Akses</th>
                <th className="px-3.5 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {employees.map((emp) => {
                const canDelete = !(emp.role === 'owner' && stats.ownerCount <= 1);
                return (
                  <tr
                    key={emp.id}
                    data-testid={`employee-row-${emp.id}`}
                    className={`transition-colors hover:bg-[#F4F6F5]/50 ${
                      emp.is_active ? '' : 'opacity-60'
                    }`}
                  >
                    {/* Name & Position */}
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E6F5EE] text-xs font-bold text-[#109A58]">
                          {emp.avatar_initials}
                        </div>
                        <div className="min-w-[130px]">
                          {isCellEditing(emp.id, 'full_name') ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus
                                aria-label="Edit nama karyawan"
                                value={draftValue}
                                onChange={(e) => setDraftValue(e.target.value)}
                                onKeyDown={(e) => handleInlineKeyDown(e, emp, 'full_name')}
                                onBlur={() => commitInlineEdit(emp, 'full_name')}
                                className="h-7 w-36 rounded-lg border border-[#109A58] bg-white px-2 text-xs font-semibold text-[#1A2E26] focus:outline-none"
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => commitInlineEdit(emp, 'full_name')}
                                aria-label="Simpan nama"
                                className="rounded bg-[#109A58] p-1 text-white"
                              >
                                <Check className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <div
                              data-testid={`emp-name-${emp.id}`}
                              title="Double-click untuk edit nama"
                              onDoubleClick={() => startInlineEdit(emp, 'full_name')}
                              className="cursor-pointer rounded px-1 py-0.5 text-xs font-semibold text-[#1A2E26] hover:bg-[#E6F5EE]/60"
                            >
                              {emp.full_name}
                            </div>
                          )}

                          {isCellEditing(emp.id, 'position') ? (
                            <input
                              type="text"
                              autoFocus
                              aria-label="Edit jabatan karyawan"
                              value={draftValue}
                              onChange={(e) => setDraftValue(e.target.value)}
                              onKeyDown={(e) => handleInlineKeyDown(e, emp, 'position')}
                              onBlur={() => commitInlineEdit(emp, 'position')}
                              className="mt-0.5 h-6 w-36 rounded-md border border-[#109A58] bg-white px-2 text-[11px] text-[#1A2E26] focus:outline-none"
                            />
                          ) : (
                            <div
                              data-testid={`emp-position-${emp.id}`}
                              title="Double-click untuk edit jabatan"
                              onDoubleClick={() => startInlineEdit(emp, 'position')}
                              className="cursor-pointer rounded px-1 text-[11px] text-[#6B7280] hover:bg-[#E6F5EE]/60"
                            >
                              {emp.position || 'Tambah jabatan...'}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Contact: Email + WhatsApp (independently double-clickable) */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {isCellEditing(emp.id, 'email') ? (
                          <input
                            type="email"
                            autoFocus
                            aria-label="Edit email karyawan"
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onKeyDown={(e) => handleInlineKeyDown(e, emp, 'email')}
                            onBlur={() => commitInlineEdit(emp, 'email')}
                            className="h-6 w-44 rounded-md border border-[#109A58] bg-white px-2 text-xs text-[#1A2E26] focus:outline-none"
                          />
                        ) : (
                          <div
                            data-testid={`emp-email-${emp.id}`}
                            title="Double-click untuk edit email"
                            onDoubleClick={() => startInlineEdit(emp, 'email')}
                            className="cursor-pointer rounded px-1 py-0.5 text-xs text-[#1A2E26] hover:bg-[#E6F5EE]/60"
                          >
                            {emp.email}
                          </div>
                        )}

                        {isCellEditing(emp.id, 'phone_number') ? (
                          <input
                            type="tel"
                            autoFocus
                            aria-label="Edit no whatsapp karyawan"
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onKeyDown={(e) => handleInlineKeyDown(e, emp, 'phone_number')}
                            onBlur={() => commitInlineEdit(emp, 'phone_number')}
                            className="h-6 w-36 rounded-md border border-[#109A58] bg-white px-2 font-mono text-[11px] text-[#1A2E26] focus:outline-none"
                          />
                        ) : (
                          <div
                            data-testid={`emp-phone-${emp.id}`}
                            title="Double-click untuk edit No. WhatsApp"
                            onDoubleClick={() => startInlineEdit(emp, 'phone_number')}
                            className="cursor-pointer rounded px-1 font-mono text-[11px] text-[#6B7280] hover:bg-[#E6F5EE]/60"
                          >
                            {emp.phone_number}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => openDetailModal(emp)}
                          title="Klik untuk atur Username & Kata Sandi login"
                          className="mt-0.5 inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-[#109A58] hover:bg-[#E6F5EE]"
                        >
                          <KeyRound className="h-3 w-3 shrink-0" />
                          {emp.username ? (
                            <span className="font-mono">@{emp.username}</span>
                          ) : (
                            <span className="text-[#6B7280]">Atur username login</span>
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Shift */}
                    <td
                      data-testid={`emp-shift-${emp.id}`}
                      title="Double-click untuk edit jadwal shift"
                      onDoubleClick={() => startInlineEdit(emp, 'shift')}
                      className="cursor-pointer px-3 py-3 text-xs text-[#6B7280] whitespace-nowrap"
                    >
                      {isCellEditing(emp.id, 'shift') ? (
                        <input
                          type="text"
                          list="brewflow-shift-presets"
                          autoFocus
                          aria-label="Edit shift karyawan"
                          value={draftValue}
                          onChange={(e) => setDraftValue(e.target.value)}
                          onKeyDown={(e) => handleInlineKeyDown(e, emp, 'shift')}
                          onBlur={() => commitInlineEdit(emp, 'shift')}
                          className="h-7 w-44 rounded-lg border border-[#109A58] bg-white px-2 text-xs text-[#1A2E26] focus:outline-none"
                        />
                      ) : (
                        <span className="rounded px-1 py-0.5 hover:bg-[#E6F5EE]/60">
                          {emp.shift || '-'}
                        </span>
                      )}
                    </td>

                    {/* Employment Status & Join Date */}
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {isCellEditing(emp.id, 'employment_status') ? (
                          <select
                            autoFocus
                            aria-label="Edit status kerja"
                            value={draftValue}
                            onChange={(e) => {
                              setDraftValue(e.target.value);
                              updateEmployee(emp.id, {
                                employment_status: e.target.value as EmploymentStatus,
                              });
                              setEditingCell(null);
                              notify(`Status kerja "${emp.full_name}" diperbarui.`);
                            }}
                            onBlur={cancelInlineEdit}
                            className="h-7 w-28 rounded-lg border border-[#109A58] bg-white px-1.5 text-xs font-medium text-[#1A2E26]"
                          >
                            {EMPLOYMENT_STATUS_OPTIONS.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span
                              title="Double-click untuk edit status kerja"
                              onDoubleClick={() => startInlineEdit(emp, 'employment_status')}
                              className="cursor-pointer rounded-full bg-[#F4F6F5] px-2 py-0.5 text-[11px] font-semibold text-[#1A2E26] hover:bg-[#E6F5EE]"
                            >
                              {emp.employment_status || 'Tetap'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  emp.role === 'owner' &&
                                  emp.is_active &&
                                  stats.activeOwnerCount <= 1
                                ) {
                                  notify(
                                    'Minimal harus ada 1 akun Owner aktif agar akses manajemen tetap terjaga.'
                                  );
                                  return;
                                }
                                updateEmployee(emp.id, { is_active: !emp.is_active });
                                notify(
                                  `Status akun "${emp.full_name}" diubah menjadi ${!emp.is_active ? 'Aktif' : 'Nonaktif'}.`
                                );
                              }}
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                emp.is_active
                                  ? 'bg-[#E6F5EE] text-[#109A58]'
                                  : 'bg-[#FEF2F2] text-[#EF4444]'
                              }`}
                            >
                              {emp.is_active ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </div>
                        )}

                        {isCellEditing(emp.id, 'join_date') ? (
                          <input
                            type="date"
                            autoFocus
                            aria-label="Edit tanggal bergabung"
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onKeyDown={(e) => handleInlineKeyDown(e, emp, 'join_date')}
                            onBlur={() => commitInlineEdit(emp, 'join_date')}
                            className="mt-0.5 h-6 w-32 rounded border border-[#109A58] bg-white px-1.5 text-[11px] text-[#1A2E26]"
                          />
                        ) : (
                          <span
                            title="Double-click untuk edit tanggal bergabung"
                            onDoubleClick={() => startInlineEdit(emp, 'join_date')}
                            className="cursor-pointer text-[11px] text-[#6B7280] tabular-nums hover:text-[#109A58]"
                          >
                            Gabung: {emp.join_date || emp.created_at.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Monthly Salary */}
                    <td
                      data-testid={`emp-salary-${emp.id}`}
                      title="Double-click untuk edit gaji bulanan"
                      onDoubleClick={() => startInlineEdit(emp, 'monthly_salary')}
                      className="cursor-pointer px-3 py-3 text-right text-xs font-semibold text-[#1A2E26] tabular-nums whitespace-nowrap"
                    >
                      {isCellEditing(emp.id, 'monthly_salary') ? (
                        <input
                          type="number"
                          min={0}
                          autoFocus
                          aria-label="Edit gaji bulanan karyawan"
                          value={draftValue}
                          onChange={(e) => setDraftValue(e.target.value)}
                          onKeyDown={(e) => handleInlineKeyDown(e, emp, 'monthly_salary')}
                          onBlur={() => commitInlineEdit(emp, 'monthly_salary')}
                          className="h-7 w-28 rounded-lg border border-[#109A58] bg-white px-2 text-right text-xs font-semibold text-[#1A2E26] tabular-nums focus:outline-none"
                        />
                      ) : (
                        <span className="rounded px-1 py-0.5 hover:bg-[#E6F5EE]/60">
                          {emp.monthly_salary ? formatRupiah(emp.monthly_salary) : '—'}
                        </span>
                      )}
                    </td>

                    {/* Role */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <select
                        aria-label={`Ubah role untuk ${emp.full_name}`}
                        value={emp.role}
                        onChange={(e) => {
                          const nextRole = e.target.value as UserRole;
                          if (nextRole === emp.role) return;
                          setConfirmState({
                            open: true,
                            variant: 'warning',
                            title: 'Konfirmasi Perubahan Role Akses',
                            description: (
                              <span>
                                Ubah hak akses <strong className="text-[#1A2E26]">{emp.full_name}</strong>{' '}
                                dari <strong>{getRoleDisplayLabel(emp.role)}</strong> menjadi{' '}
                                <strong className="text-[#109A58]">
                                  {getRoleDisplayLabel(nextRole)}
                                </strong>
                                ?
                              </span>
                            ),
                            confirmLabel: 'Ya, Ubah Role',
                            onConfirm: async () => {
                              const res = await updateEmployeeRole(emp.id, nextRole);
                              if (!res.ok) {
                                notify(res.error || 'Gagal mengubah role di Supabase.');
                              } else {
                                notify(
                                  `Role "${emp.full_name}" diubah ke ${getRoleDisplayLabel(nextRole)}.`
                                );
                              }
                            },
                          });
                        }}
                        className="h-8 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-semibold text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      >
                        <option value="owner">{getRoleDisplayLabel('owner')}</option>
                        <option value="manager">{getRoleDisplayLabel('manager')}</option>
                        <option value="cashier">{getRoleDisplayLabel('cashier')}</option>
                      </select>
                    </td>

                    {/* Actions */}
                    <td className="px-3.5 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openDetailModal(emp)}
                          aria-label={`Edit detail operasional ${emp.full_name}`}
                          className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#E6F5EE] hover:text-[#109A58]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmState({
                                open: true,
                                variant: 'danger',
                                title: 'Hapus Data Karyawan?',
                                description: (
                                  <span>
                                    Apakah Anda yakin ingin menghapus{' '}
                                    <strong className="text-[#1A2E26]">{emp.full_name}</strong> (
                                    {emp.email})? Akun ini tidak akan bisa login lagi ke BrewFlow POS.
                                  </span>
                                ),
                                confirmLabel: 'Ya, Hapus Karyawan',
                                onConfirm: async () => {
                                  const res = await deleteEmployee(emp.id);
                                  if (!res.ok) {
                                    notify(
                                      res.error || 'Karyawan dihapus lokal, gagal hapus di Supabase.'
                                    );
                                  } else {
                                    notify(`Data karyawan "${emp.full_name}" telah dihapus.`);
                                  }
                                },
                              });
                            }}
                            aria-label={`Hapus karyawan ${emp.full_name}`}
                            className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Owner Username Login Confirmation Email Audit Card */}
      <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#1A2E26]">
                Konfirmasi Email Login Username (Khusus Owner)
              </h2>
              <p className="mt-0.5 text-xs text-[#6B7280]">
                Setiap login tanpa Google OAuth (menggunakan Username &amp; Kata Sandi) akan
                mengirim email konfirmasi otomatis ke{' '}
                <strong className="text-[#1A2E26]">
                  {settings.ownerLoginAlertEmail || DEFAULT_OWNER_ALERT_EMAIL}
                </strong>
                .
              </p>
            </div>
          </div>
          <span className="rounded-full bg-[#E6F5EE] px-3 py-1 text-[11px] font-semibold text-[#109A58] tabular-nums">
            {usernameLoginLogs.length} riwayat login
          </span>
        </div>

        <div className="rounded-xl border border-[#109A58]/20 bg-[#E6F5EE]/40 px-3.5 py-2.5 text-[11px] leading-relaxed text-[#1A2E26]">
          <strong>Pengiriman Langsung via Sandi Aplikasi Google (Gmail SMTP):</strong> Cukup tambahkan{' '}
          <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">GMAIL_USER</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">GMAIL_APP_PASSWORD</code>{' '}
          (16 karakter dari Google Account → Keamanan → Sandi Aplikasi), dan{' '}
          <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">OWNER_ALERT_EMAIL</code>{' '}
          di <strong>Vercel → Settings → Environment Variables</strong> lalu redeploy.
        </div>

        {usernameLoginLogs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F4F6F5]/50 px-4 py-4 text-xs text-[#6B7280]">
            Belum ada aktivitas login menggunakan username. Klik ikon pensil /{' '}
            <strong>Atur username login</strong> pada baris karyawan di atas untuk menetapkan
            username &amp; kata sandi.
          </p>
        ) : (
          <div className="divide-y divide-[#E5E7EB] overflow-hidden rounded-xl border border-[#E5E7EB]">
            {usernameLoginLogs.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#1A2E26]">
                    {entry.employee_name}{' '}
                    <span className="font-mono font-normal text-[#109A58]">
                      (@{entry.username})
                    </span>{' '}
                    <span className="font-normal text-[#6B7280]">
                      · {getRoleDisplayLabel(entry.role)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    Ke: {entry.owner_email} · {entry.device_info} ·{' '}
                    <span className="tabular-nums">{formatDateTime(entry.logged_in_at)}</span>
                  </p>
                  {entry.email_error && (
                    <p className="mt-0.5 text-[11px] text-[#B91C1C]">{entry.email_error}</p>
                  )}
                </div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                    entry.email_status === 'sent'
                      ? 'bg-[#E6F5EE] text-[#109A58]'
                      : entry.email_status === 'queued'
                        ? 'bg-[#FFFBEB] text-[#B45309]'
                        : 'bg-[#FEF2F2] text-[#EF4444]'
                  }`}
                >
                  {entry.email_status === 'sent'
                    ? 'Email Terkirim'
                    : entry.email_status === 'queued'
                      ? 'Menunggu Edge Function'
                      : 'Gagal Kirim Email'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full Employee Operational Detail Edit Modal */}
      {detailEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Detail Karyawan ${detailEmployee.full_name}`}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Edit Profil &amp; Kredensial Karyawan
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Atur username &amp; kata sandi login, kontak darurat, shift, dan gaji bulanan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailEmployee(null)}
                aria-label="Tutup modal edit karyawan"
                className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveDetailModal}
              className="max-h-[80vh] overflow-y-auto space-y-4 p-6"
            >
              {modalError && (
                <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]">
                  {modalError}
                </p>
              )}

              {/* Owner-Managed Username & Password Section */}
              <div className="rounded-xl border border-[#109A58]/25 bg-[#E6F5EE]/40 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#1A2E26]">
                  <KeyRound className="h-4 w-4 text-[#109A58]" />
                  <span>Login Username &amp; Kata Sandi (Tanpa Google OAuth)</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="mod-emp-username"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      Username
                    </label>
                    <input
                      id="mod-emp-username"
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={modalUsername}
                      onChange={(e) => setModalUsername(e.target.value)}
                      placeholder="contoh: kasir.dimas"
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="mod-emp-password"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      {detailEmployee.has_password ? 'Kata Sandi Baru (Opsional)' : 'Kata Sandi'}
                    </label>
                    <div className="relative mt-1">
                      <input
                        id="mod-emp-password"
                        type={showModalPassword ? 'text' : 'password'}
                        value={modalPassword}
                        onChange={(e) => setModalPassword(e.target.value)}
                        placeholder={
                          detailEmployee.has_password
                            ? 'Kosongkan jika tidak diubah'
                            : 'Minimal 6 karakter'
                        }
                        className="h-10 w-full rounded-xl border border-[#E5E7EB] bg-white pl-3 pr-9 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowModalPassword((prev) => !prev)}
                        aria-label={
                          showModalPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'
                        }
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#1A2E26]"
                      >
                        {showModalPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-[#4B5563]">
                  Kata sandi dienkripsi dengan hash satu arah. Setiap login menggunakan username ini
                  otomatis mengirim email konfirmasi ke{' '}
                  <strong>{settings.ownerLoginAlertEmail || DEFAULT_OWNER_ALERT_EMAIL}</strong>.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label htmlFor="mod-emp-name" className="block text-xs font-semibold text-[#1A2E26]">
                    Nama Lengkap
                  </label>
                  <input
                    id="mod-emp-name"
                    type="text"
                    value={modalDraft.full_name ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, full_name: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="mod-emp-pos" className="block text-xs font-semibold text-[#1A2E26]">
                    Jabatan / Posisi
                  </label>
                  <input
                    id="mod-emp-pos"
                    type="text"
                    value={modalDraft.position ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, position: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="mod-emp-email" className="block text-xs font-semibold text-[#1A2E26]">
                    Email Kerja
                  </label>
                  <input
                    id="mod-emp-email"
                    type="email"
                    value={modalDraft.email ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, email: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="mod-emp-wa" className="block text-xs font-semibold text-[#1A2E26]">
                    No. WhatsApp
                  </label>
                  <input
                    id="mod-emp-wa"
                    type="tel"
                    value={modalDraft.phone_number ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, phone_number: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="mod-emp-shift" className="block text-xs font-semibold text-[#1A2E26]">
                    Jadwal Shift
                  </label>
                  <input
                    id="mod-emp-shift"
                    type="text"
                    list="brewflow-shift-presets"
                    value={modalDraft.shift ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, shift: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="mod-emp-salary" className="block text-xs font-semibold text-[#1A2E26]">
                    Gaji Bulanan (Rp)
                  </label>
                  <input
                    id="mod-emp-salary"
                    type="number"
                    min={0}
                    value={modalDraft.monthly_salary ?? 0}
                    onChange={(e) =>
                      setModalDraft((p) => ({ ...p, monthly_salary: Number(e.target.value) || 0 }))
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs tabular-nums text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="mod-emp-status" className="block text-xs font-semibold text-[#1A2E26]">
                    Status Kepegawaian
                  </label>
                  <select
                    id="mod-emp-status"
                    value={modalDraft.employment_status ?? 'Tetap'}
                    onChange={(e) =>
                      setModalDraft((p) => ({
                        ...p,
                        employment_status: e.target.value as EmploymentStatus,
                      }))
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  >
                    {EMPLOYMENT_STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="mod-emp-join" className="block text-xs font-semibold text-[#1A2E26]">
                    Tanggal Bergabung
                  </label>
                  <input
                    id="mod-emp-join"
                    type="date"
                    value={modalDraft.join_date ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, join_date: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="mod-emp-ec" className="block text-xs font-semibold text-[#1A2E26]">
                    Kontak Darurat (Nama &amp; No. HP Keluarga)
                  </label>
                  <input
                    id="mod-emp-ec"
                    type="text"
                    value={modalDraft.emergency_contact ?? ''}
                    onChange={(e) =>
                      setModalDraft((p) => ({ ...p, emergency_contact: e.target.value }))
                    }
                    placeholder="Misal: Ibu Sari · 0812-3456-7890"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="mod-emp-notes" className="block text-xs font-semibold text-[#1A2E26]">
                    Catatan Operasional (Hari Libur Tetap, Sertifikasi, dll.)
                  </label>
                  <textarea
                    id="mod-emp-notes"
                    rows={2}
                    value={modalDraft.notes ?? ''}
                    onChange={(e) => setModalDraft((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Misal: Libur tetap Selasa, PIC kalibrasi grinder pagi"
                    className="mt-1 w-full rounded-xl border border-[#E5E7EB] p-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  onClick={() => setDetailEmployee(null)}
                  className="h-10 rounded-full border border-[#E5E7EB] px-5 text-xs font-semibold text-[#6B7280]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingModal}
                  className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-60"
                >
                  {savingModal ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        variant={confirmState.variant}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel="Batal"
        isBusy={confirmBusy}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
        onConfirm={async () => {
          setConfirmBusy(true);
          try {
            await confirmState.onConfirm();
          } finally {
            setConfirmBusy(false);
            setConfirmState((prev) => ({ ...prev, open: false }));
          }
        }}
      />
    </div>
  );
}
