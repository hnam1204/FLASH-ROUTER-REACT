import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Account,
  accountAction,
  apiUrl,
  createAccount,
  deleteAccount,
  describeApiError,
  listAccounts,
  RouterEvent,
} from './api';

type Notice = { type: 'success' | 'error' | 'info'; message: string } | null;
type EventState = 'checking' | 'connected' | 'unavailable';

const sessionLabels: Record<Account['sessionStatus'], string> = {
  UNKNOWN: 'Chưa xác định',
  LOGIN_REQUIRED: 'Cần đăng nhập',
  AUTHENTICATING: 'Đang xác thực',
  ACTION_REQUIRED: 'Cần bạn xác minh',
  ACTIVE: 'Phiên đang hoạt động',
  EXPIRED: 'Phiên đã hết hạn',
};

const browserLabels: Record<Account['browserStatus'], string> = {
  STOPPED: 'Đã đóng',
  STARTING: 'Đang khởi động',
  RUNNING: 'Đang chạy',
  STOPPING: 'Đang đóng',
  CRASHED: 'Đã dừng bất thường',
};

function Icon({ name }: { name: 'arrow' | 'check' | 'close' | 'external' | 'refresh' | 'trash' | 'plus' | 'search' | 'shield' }) {
  const paths = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    external: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 5v6h-6" /></>,
    trash: <><path d="M4 7h16M10 11v5M14 11v5" /><path d="M6 7l1 12h10l1-12M9 7V4h6v3" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  };

  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function formatTime(value: string | null): string {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa có dữ liệu';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status: string): string {
  if (status === 'ACTIVE' || status === 'RUNNING') return 'status status--good';
  if (status === 'ACTION_REQUIRED' || status === 'LOGIN_REQUIRED' || status === 'EXPIRED' || status === 'CRASHED') return 'status status--warn';
  if (status === 'STARTING' || status === 'STOPPING' || status === 'AUTHENTICATING') return 'status status--progress';
  return 'status status--muted';
}

function eventLabel(event: RouterEvent): string {
  if (event.safe_message) return event.safe_message;
  return 'Backend đã gửi một sự kiện an toàn.';
}

function normalizeEvent(value: unknown): RouterEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<RouterEvent>;
  if (typeof event.event_id !== 'string' || typeof event.timestamp !== 'string' || typeof event.safe_message !== 'string') return null;
  if (event.severity !== 'info' && event.severity !== 'warning' && event.severity !== 'error') return null;
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    account_id: typeof event.account_id === 'string' ? event.account_id : undefined,
    job_id: typeof event.job_id === 'string' ? event.job_id : undefined,
    type: typeof event.type === 'string' ? event.type : 'event',
    severity: event.severity,
    stage: typeof event.stage === 'string' ? event.stage : 'runtime',
    duration_ms: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
    safe_message: event.safe_message,
    error_code: typeof event.error_code === 'string' ? event.error_code : undefined,
  };
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [secretInput, setSecretInput] = useState('');
  const [accountName, setAccountName] = useState('');
  const [creating, setCreating] = useState(false);
  const [actions, setActions] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [eventState, setEventState] = useState<EventState>('checking');
  const [events, setEvents] = useState<RouterEvent[]>([]);
  const [eventError, setEventError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');

    listAccounts(submittedQuery, undefined, controller.signal)
      .then((page) => {
        setAccounts(page.accounts);
        setNextCursor(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAccounts([]);
        setNextCursor(null);
        setListError(describeApiError(error));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [submittedQuery, refreshToken]);

  useEffect(() => {
    let opened = false;
    let settled = false;
    const source = new EventSource(apiUrl('/api/events/stream'));
    const timeout = window.setTimeout(() => {
      if (opened || settled) return;
      settled = true;
      source.close();
      setEventState('unavailable');
      setEventError('Backend chưa cung cấp luồng sự kiện realtime.');
    }, 4500);

    const handleEvent = (message: MessageEvent<string>) => {
      try {
        const event = normalizeEvent(JSON.parse(message.data));
        if (event) setEvents((current) => [event, ...current].slice(0, 40));
      } catch {
        // Ignore malformed stream frames; the console only displays validated safe events.
      }
    };

    source.onopen = () => {
      opened = true;
      settled = true;
      window.clearTimeout(timeout);
      setEventState('connected');
      setEventError('');
    };
    source.onmessage = handleEvent;
    source.addEventListener('router_event', handleEvent as EventListener);
    source.onerror = () => {
      if (!opened) {
        settled = true;
        window.clearTimeout(timeout);
        source.close();
        setEventState('unavailable');
        setEventError('Backend chưa cung cấp luồng sự kiện realtime.');
        return;
      }
      setEventError('Kết nối sự kiện bị gián đoạn; đang chờ backend phục hồi.');
    };

    return () => {
      window.clearTimeout(timeout);
      source.close();
    };
  }, []);

  const stats = useMemo(() => ({
    visible: accounts.length,
    running: accounts.filter((account) => account.browserStatus === 'RUNNING').length,
    attention: accounts.filter((account) => ['ACTION_REQUIRED', 'LOGIN_REQUIRED', 'EXPIRED', 'CRASHED'].includes(account.sessionStatus) || account.browserStatus === 'CRASHED').length,
  }), [accounts]);

  function reloadAccounts() {
    setRefreshToken((value) => value + 1);
  }

  function showNotice(type: NonNullable<Notice>['type'], message: string) {
    setNotice({ type, message });
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secretInput.trim() || creating) return;

    setCreating(true);
    setNotice(null);
    try {
      const result = await createAccount(secretInput.trim(), accountName);
      setSecretInput('');
      setAccountName('');
      reloadAccounts();
      showNotice('success', result.jobId ? `Đã tiếp nhận tạo tài khoản. Mã tác vụ: ${result.jobId}` : 'Đã gửi yêu cầu tạo tài khoản.');
    } catch (error) {
      showNotice('error', describeApiError(error));
    } finally {
      setSecretInput('');
      setCreating(false);
    }
  }

  async function handleAction(account: Account, action: 'open' | 'close' | 'check') {
    if (actions[account.id]) return;
    setActions((current) => ({ ...current, [account.id]: action }));
    setNotice(null);
    try {
      const result = await accountAction(account.id, action);
      reloadAccounts();
      const actionText = action === 'open' ? 'mở trình duyệt' : action === 'close' ? 'đóng trình duyệt' : 'kiểm tra phiên';
      showNotice('success', result.jobId ? `Đã xếp hàng tác vụ ${actionText}. Mã tác vụ: ${result.jobId}` : `Đã gửi yêu cầu ${actionText}.`);
    } catch (error) {
      showNotice('error', describeApiError(error));
    } finally {
      setActions((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleteConfirmation.trim() !== deleteTarget.email || deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      const result = await deleteAccount(deleteTarget);
      setDeleteTarget(null);
      setDeleteConfirmation('');
      reloadAccounts();
      showNotice('success', result.jobId ? `Đã xếp hàng xóa dữ liệu cục bộ. Mã tác vụ: ${result.jobId}` : 'Đã gửi yêu cầu xóa dữ liệu cục bộ.');
    } catch (error) {
      showNotice('error', describeApiError(error));
    } finally {
      setDeleting(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listAccounts(submittedQuery, nextCursor);
      setAccounts((current) => [...current, ...page.accounts]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showNotice('error', describeApiError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <a className="wordmark" href="#main-content" aria-label="FLASH ROUTER, về đầu trang">
            FLASH <span>ROUTER</span>
          </a>
          <div className="topbar__meta">
            <span className="local-badge"><span className="pulse-dot" /> Máy cục bộ</span>
            <a className="owner-link" href="https://zalo.me/0379052767" target="_blank" rel="noreferrer">
              Liên hệ chủ dự án <Icon name="external" />
            </a>
          </div>
        </div>
      </header>

      <main id="main-content" className="page-content">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero__copy">
            <p className="eyebrow"><span className="eyebrow__line" /> BẢNG ĐIỀU KHIỂN PHIÊN CỤC BỘ</p>
            <h1 id="page-title">Quản lý phiên Chrome<br /><em>rõ ràng, an toàn.</em></h1>
            <p className="hero__description">Theo dõi trạng thái các tài khoản đã đăng ký trên máy này. Mọi thao tác đều gọi backend thật và không hiển thị thông tin bí mật.</p>
          </div>
          <div className="hero__aside" aria-label="Trạng thái kết nối">
            <div className="hero-card">
              <div className="hero-card__icon"><Icon name="shield" /></div>
              <div>
                <strong>Chế độ bảo vệ</strong>
                <span>Không lưu mật khẩu hoặc mã 2FA</span>
              </div>
            </div>
            <div className="hero-stamp">LOCAL<br /><span>ONLY</span></div>
          </div>
        </section>

        <section className="stats-grid" aria-label="Tổng quan nhanh">
          <div className="stat-card stat-card--primary"><span className="stat-card__label">Đang hiển thị</span><strong>{loading ? '—' : stats.visible}</strong><small>tài khoản trong danh sách</small></div>
          <div className="stat-card"><span className="stat-card__label">Trình duyệt hoạt động</span><strong>{loading ? '—' : stats.running}</strong><small>phiên Chrome đang chạy</small></div>
          <div className="stat-card stat-card--alert"><span className="stat-card__label">Cần chú ý</span><strong>{loading ? '—' : stats.attention}</strong><small>cần kiểm tra hoặc xác minh</small></div>
        </section>

        {notice && <div className={`notice notice--${notice.type}`} role="status"><span>{notice.message}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Đóng thông báo"><Icon name="close" /></button></div>}

        <section className="workspace-grid" aria-label="Quản lý tài khoản">
          <div className="panel import-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">01 / THÊM TÀI KHOẢN</p><h2>Nhập thông tin kết nối</h2></div>
              <span className="step-number">01</span>
            </div>
            <p className="panel-intro">Gửi chuỗi kết nối một lần để backend tạo hồ sơ Chrome được tách riêng.</p>
            <form onSubmit={handleCreate}>
              <div className="field-group">
                <label htmlFor="account-input">Chuỗi tài khoản</label>
                <input id="account-input" type="password" value={secretInput} onChange={(event) => setSecretInput(event.target.value)} placeholder="EMAIL|PASS|2FA_SECRET" autoComplete="new-password" spellCheck={false} required />
                <p className="field-hint"><Icon name="shield" /> Chỉ gửi tới backend khi bạn bấm thêm. Không lưu vào localStorage, không hiển thị lại sau khi gửi.</p>
              </div>
              <div className="field-group">
                <label htmlFor="account-name">Tên hiển thị <span>(không bắt buộc)</span></label>
                <input id="account-name" type="text" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Ví dụ: Tài khoản làm việc" maxLength={120} />
              </div>
              <button className="button button--primary button--wide" type="submit" disabled={creating || !secretInput.trim()} title={!secretInput.trim() ? 'Nhập chuỗi EMAIL|PASS|2FA_SECRET trước' : undefined}>
                <Icon name="plus" /> {creating ? 'Đang gửi...' : 'Thêm tài khoản'}
              </button>
            </form>
            <div className="security-note"><span className="security-note__mark"><Icon name="shield" /></span><div><strong>Cam kết an toàn</strong><p>Password và 2FA_SECRET không được lưu trong database theo hợp đồng hệ thống.</p></div></div>
          </div>

          <div className="panel accounts-panel">
            <div className="panel-heading panel-heading--list">
              <div><p className="eyebrow">02 / DANH SÁCH HỒ SƠ</p><h2>Tài khoản đã đăng ký</h2></div>
              <button className="button button--ghost" onClick={reloadAccounts} disabled={loading} title={loading ? 'Đang tải danh sách' : 'Tải lại từ backend'}><Icon name="refresh" /> Làm mới</button>
            </div>
            <form className="search-bar" onSubmit={submitSearch} role="search">
              <Icon name="search" /><input aria-label="Tìm tài khoản" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo email hoặc tên hiển thị" /><button className="search-bar__submit" type="submit" aria-label="Tìm kiếm">Tìm</button>
            </form>
            {loading ? <div className="state-block"><div className="spinner" /><p>Đang tải danh sách từ backend...</p></div> : listError ? <div className="state-block state-block--error"><strong>Chưa thể tải danh sách</strong><p>{listError}</p><button className="button button--secondary" onClick={reloadAccounts}><Icon name="refresh" /> Thử lại</button></div> : accounts.length === 0 ? <div className="state-block state-block--empty"><span className="empty-mark">∅</span><strong>Chưa có tài khoản nào</strong><p>{submittedQuery ? 'Không có hồ sơ phù hợp với tìm kiếm hiện tại.' : 'Danh sách trống vì backend chưa trả về hồ sơ nào. Bạn có thể thêm tài khoản ở khung bên trái.'}</p></div> : <div className="account-list">{accounts.map((account) => <AccountCard key={account.id} account={account} busyAction={actions[account.id]} onAction={handleAction} onDelete={() => { setDeleteTarget(account); setDeleteConfirmation(''); }} />)}</div>}
            {!loading && !listError && nextCursor && <button className="button button--load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Đang tải thêm...' : 'Tải thêm hồ sơ'} <Icon name="arrow" /></button>}
          </div>
        </section>

        {eventState === 'connected' ? <section className="panel console-panel" aria-labelledby="console-title">
          <div className="panel-heading panel-heading--list"><div><p className="eyebrow">03 / LIVE CONSOLE</p><h2 id="console-title">Sự kiện an toàn</h2></div><span className="live-indicator"><span className="pulse-dot pulse-dot--live" /> Đang kết nối</span></div>
          {eventError && <p className="console-warning">{eventError}</p>}
          {events.length === 0 ? <div className="console-empty">Luồng đã kết nối. Chưa có sự kiện an toàn nào được backend gửi.</div> : <div className="event-list">{events.map((event) => <div className={`event-row event-row--${event.severity}`} key={event.event_id}><span className="event-time">{formatTime(event.timestamp)}</span><span className="event-stage">{event.stage}</span><span className="event-message">{eventLabel(event)}</span>{event.duration_ms !== undefined && <span className="event-duration">{event.duration_ms} ms</span>}</div>)}</div>}
        </section> : <section className="backend-capability" aria-label="Trạng thái luồng sự kiện"><span className="backend-capability__index">03</span><div><strong>{eventState === 'checking' ? 'Đang kiểm tra luồng sự kiện' : 'Backend chưa cung cấp luồng sự kiện'}</strong><p>{eventState === 'checking' ? 'Console chỉ hiển thị sau khi kết nối SSE thật được xác nhận.' : 'Console không hiển thị dữ liệu giả hoặc log không có nguồn.'}</p></div><span className="console-placeholder__status">{eventState === 'checking' ? 'ĐANG KIỂM TRA' : 'KHÔNG CÓ SSE'}</span></section>}
      </main>

      <footer className="footer"><span>FLASH ROUTER · Local session workspace</span><a href="https://zalo.me/0379052767" target="_blank" rel="noreferrer">by @hnam1204 <Icon name="external" /></a></footer>

      {deleteTarget && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><button className="icon-button modal-close" onClick={() => setDeleteTarget(null)} aria-label="Đóng hộp thoại"><Icon name="close" /></button><div className="danger-mark"><Icon name="trash" /></div><p className="eyebrow">XÁC NHẬN XÓA CỤC BỘ</p><h2 id="delete-title">Xóa hồ sơ này?</h2><p>Thao tác sẽ yêu cầu backend đóng trình duyệt và xóa dữ liệu thuộc hồ sơ <strong>{deleteTarget.email}</strong> trên máy này. Không xóa tài khoản từ nhà cung cấp.</p><label htmlFor="delete-confirmation">Nhập lại email để xác nhận</label><input id="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={deleteTarget.email} autoFocus /><div className="modal-actions"><button className="button button--ghost" onClick={() => setDeleteTarget(null)}>Hủy</button><button className="button button--danger" onClick={handleDelete} disabled={deleting || deleteConfirmation.trim() !== deleteTarget.email} title={deleteConfirmation.trim() !== deleteTarget.email ? 'Nhập chính xác email của hồ sơ' : undefined}><Icon name="trash" /> {deleting ? 'Đang gửi...' : 'Xác nhận xóa'}</button></div></div></div>}
    </div>
  );
}

function AccountCard({ account, busyAction, onAction, onDelete }: { account: Account; busyAction?: string; onAction: (account: Account, action: 'open' | 'close' | 'check') => void; onDelete: () => void }) {
  const isBusy = Boolean(busyAction);
  const openDisabled = isBusy || account.browserStatus === 'RUNNING' || account.browserStatus === 'STARTING';
  const closeDisabled = isBusy || account.browserStatus === 'STOPPED' || account.browserStatus === 'STOPPING';
  const actionText = busyAction === 'open' ? 'Đang mở...' : busyAction === 'close' ? 'Đang đóng...' : busyAction === 'check' ? 'Đang kiểm tra...' : '';

  return <article className="account-card"><div className="account-card__top"><div className="account-identity"><div className="account-avatar">{account.email.slice(0, 1).toUpperCase()}</div><div><h3>{account.name || 'Chưa xác định'}</h3><p>{account.email}</p></div></div><span className={statusClass(account.sessionStatus)}><span className="status-dot" /> {sessionLabels[account.sessionStatus] ?? 'Chưa xác định'}</span></div><div className="account-card__details"><span><small>TRÌNH DUYỆT</small><strong className={statusClass(account.browserStatus)}>{browserLabels[account.browserStatus] ?? 'Chưa xác định'}</strong></span><span><small>GÓI</small><strong>{account.plan || 'Chưa xác định'}</strong></span><span><small>ĐĂNG NHẬP GẦN NHẤT</small><strong>{formatTime(account.lastLoginAt)}</strong></span></div><div className="account-card__actions"><button className="button button--secondary" onClick={() => onAction(account, 'open')} disabled={openDisabled} title={account.browserStatus === 'RUNNING' ? 'Trình duyệt đang chạy' : account.browserStatus === 'STARTING' ? 'Trình duyệt đang khởi động' : undefined}><Icon name="arrow" /> {busyAction === 'open' ? actionText : 'Mở trình duyệt'}</button><button className="button button--secondary" onClick={() => onAction(account, 'close')} disabled={closeDisabled} title={account.browserStatus === 'STOPPED' ? 'Trình duyệt đã đóng' : account.browserStatus === 'STOPPING' ? 'Đang đóng trình duyệt' : undefined}><Icon name="close" /> {busyAction === 'close' ? actionText : 'Đóng'}</button><button className="button button--secondary" onClick={() => onAction(account, 'check')} disabled={isBusy} title={isBusy ? 'Đang xử lý tác vụ khác' : 'Yêu cầu backend kiểm tra trạng thái phiên'}><Icon name="check" /> {busyAction === 'check' ? actionText : 'Kiểm tra'}</button><button className="button button--danger-quiet" onClick={onDelete} disabled={isBusy} title={isBusy ? 'Chờ tác vụ hiện tại hoàn tất' : 'Xóa hồ sơ cục bộ'}><Icon name="trash" /> Xóa</button></div></article>;
}

export default App;
