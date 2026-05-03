# Use Case Code Flow Documentation
> HL-MCK Automation Antidetect Browser — Luồng thực thi code theo từng Use Case

---

## Kiến trúc tổng quan

```
Người dùng (UI / API / Script)
        │
        ├─── Giao diện Desktop (React UI)
        │         └── preload/index.js (window.electronAPI.xxx)
        │                   └── ipc/handlers.js (ipcMain.handle)
        │
        └─── HTTP REST API (Fastify)
                  └── api/restServer.js (route handlers)
                            │
                            ├── storage/profiles.js    (CRUD profile)
                            ├── storage/proxies.js     (CRUD proxy)
                            ├── storage/scripts.js     (CRUD script)
                            ├── storage/taskLogs.js    (CRUD task log)
                            ├── controllers/profiles.js (launch/stop browser)
                            └── engine/actions.js      (browser interactions)
```

---

## NHÓM UC_08 — Profile Management (qua UI Desktop)

### UC_08.01 — Create Browser Profile

**Trigger:** User bấm nút "Create" trên ProfileForm.jsx

```
ProfileForm.jsx: handleSubmit()
    → window.electronAPI.saveProfile(profilePayload)    [preload/index.js]
    → ipcMain.handle('save-profile')                    [ipc/handlers.js:80]
    → saveProfileInternal(profile)                      [storage/profiles.js]
        → normalizeProfileInput(profile)                  — merge với DEFAULT_SETTINGS
        → readProfiles()                                  — đọc profiles.json
        → kiểm tra trùng tên
        → gán id = crypto.randomUUID() nếu profile mới
        → gán fingerprint = generateDefaultFingerprint() nếu chưa có
        → writeProfiles([...existing, newProfile])        — ghi lại file
    → appendLog('system', 'Profile saved: ...')
    → return { success: true, profile }
    → UI: broadcast 'profiles-updated' → React re-render danh sách
```

**File liên quan:**
- [src/renderer/components/ProfileForm.jsx](src/renderer/components/ProfileForm.jsx) — UI form
- [src/main/ipc/handlers.js](src/main/ipc/handlers.js) — handle('save-profile')
- [src/main/storage/profiles.js](src/main/storage/profiles.js) — saveProfileInternal()

---

### UC_08.02 — Edit Profile Configuration

**Trigger:** User chỉnh sửa profile và bấm "Save"

```
ProfileForm.jsx: handleSubmit() [với profile.id đã có]
    → window.electronAPI.saveProfile(profilePayload)
    → ipcMain.handle('save-profile')                    [ipc/handlers.js:80]
    → saveProfileInternal(profile)                      [storage/profiles.js]
        → tìm existing = profiles.find(p => p.id === profile.id)
        → merge: { ...existing, ...profile }              — giữ field không đổi
        → writeProfiles(updated)
    → return { success: true }
```

---

### UC_08.03 — Delete Profile

**Trigger:** User bấm nút "Delete" trên ProfileList.jsx

```
UI: window.electronAPI.deleteProfile(profileId)
    → ipcMain.handle('delete-profile')                  [ipc/handlers.js:85]
        → stopProfileInternal(profileId)                  — dừng browser nếu đang chạy
        → deleteProfileInternal(profileId)              [storage/profiles.js]
            → readProfiles()
            → filter ra profile cần xóa
            → xóa file session: profiles/{id}-storage.json
            → writeProfiles(remaining)
    → return { success: true }
```

---

### UC_08.04 — Launch Profile (Visible Mode)

**Trigger:** User bấm "Launch" (headless=false)

```
UI: window.electronAPI.launchProfile(profileId, { headless: false })
    → ipcMain.handle('launch-profile')                  [ipc/handlers.js:91]
    → launchProfileInternal(profileId, options)         [controllers/profiles.js:63]
        → [Bước 1] Kiểm tra lock — nếu đã chạy hoặc đang khởi động thì return sớm
        → [Bước 2] launchingProfiles.add(profileId) — khóa tránh race condition
        → [Bước 3] setProfileStatus('STARTING') + broadcastRunningMap()
        → [Bước 4] readProfiles() — lấy cấu hình profile
        → [Bước 5] Chuẩn bị Chrome args:
            '--disable-blink-features=AutomationControlled'
            '--disable-features=AutomationControlled,...'
            '--window-size=WxH'
            '--force-webrtc-ip-handling-policy=...' (nếu cần)
        → [Bước 6] Xử lý Proxy:
            nếu có auth hoặc SOCKS → startProxyForwarder() [engine/proxyForwarder.js]
            nếu không → dùng trực tiếp
        → [Bước 7] Tìm Chrome binary:
            1. vendor/chrome-win/Chrome-bin/chrome.exe
            2. System Chrome (registry/path)
            3. Bundled Playwright Chromium (fallback)
        → [Bước 8] chromium.launch(opts) hoặc firefox.launchServer(opts)
        → [Bước 9] browser.newContext({ userAgent, locale, timezoneId, proxy, ... })
        → [Bước 10] applyFingerprintInitScripts(context, profile, settings)
            [engine/fingerprintInit.js:31]
            → addInitScript: xóa navigator.webdriver, window.__playwright
            → addInitScript: giả navigator.hardwareConcurrency, deviceMemory
            → addInitScript: giả navigator.platform, languages, plugins
            → addInitScript: giả navigator.userAgent
            → addInitScript: giả screen.width/height, devicePixelRatio
            → addInitScript: giả WebGL.getParameter(VENDOR/RENDERER)
            → addInitScript: thêm noise vào canvas.toDataURL()
            → addInitScript: giả AudioContext
        → [Bước 11] context.newPage() → page.goto(startUrl)
        → [Bước 12] runningProfiles.set(profileId, { browser, context, ... })
        → [Bước 13] setProfileStatus('RUNNING') + broadcastRunningMap()
    → return { success: true, wsEndpoint }
```

---

### UC_08.05 — Launch Profile (Headless Mode)

**Luồng giống UC_08.04**, chỉ khác:
- options.headless = true
- Browser không hiện cửa sổ, chạy ngầm
- Dùng cho automation, script chạy tự động

---

### UC_08.06 — Stop Profile

**Trigger:** User bấm "Stop" hoặc đóng profile

```
UI: window.electronAPI.stopProfile(profileId)
    → ipcMain.handle('stop-profile')                    [ipc/handlers.js:97]
    → stopProfileInternal(profileId)                    [controllers/profiles.js]
        → kiểm tra runningProfiles.has(profileId)
        → setProfileStatus('STOPPING') + broadcastRunningMap()
        → stopScreencast(profileId)                       — dừng live preview nếu có
        → lưu storage state: context.storageState() → file
        → context.close() → browser.close() → server?.close()
        → forwarder?.stop()                               — dừng proxy forwarder
        → runningProfiles.delete(profileId)
        → setProfileStatus('STOPPED') + broadcastRunningMap()
    → return { success: true }
```

---

### UC_08.07 — Add Proxy for Profile

**Trigger:** User chọn proxy trong tab General của ProfileForm

```
ProfileForm.jsx: setS('proxy', { server, username, password })
    → handleSubmit() → saveProfile(profilePayload)
        — proxy được lưu trong profile.settings.proxy
    → Khi launch: launchProfileInternal() đọc settings.proxy
        → nếu có auth/SOCKS → startProxyForwarder()
        → nếu simple HTTP → dùng trực tiếp trong browser.newContext({ proxy })
```

---

## NHÓM UC_14 — API: Profiles

### UC_14.01 — API: List All Profiles

```
HTTP GET /api/profiles
    → restServer.js: appx.get('/api/profiles')          [dòng 144]
    → handlers.getProfilesInternal()                    [storage/profiles.js]
        → readProfiles()                                  — đọc profiles.json
    → reply.send(list)                                    — trả về JSON array
```

---

### UC_14.02 — API: Create Profile

```
HTTP POST /api/profiles
Body: { "name": "...", "fingerprintOptions": { "os": "windows" }, "proxy": {...} }
    → restServer.js: appx.post('/api/profiles')         [dòng 183]
        → validate: name không rỗng
        → kiểm tra license: nếu chưa activate và đã có ≥5 profiles → 403
        → generateFingerprint(genOpts)                  [engine/fingerprintGenerator.js]
        → enrich fingerprint: canvasNoise, webglNoise, audioNoise, fonts...
        → map proxy format API → settings.proxy format
        → handlers.saveProfileInternal(profilePayload)  [storage/profiles.js]
        → broadcastProfilesUpdated()                      — cập nhật UI
    → reply.code(201).send({ success: true, profile })
```

---

### UC_14.03 — API: Edit Profile

```
HTTP PUT /api/profiles/:id
Body: { "name": "...", "headless": true, "proxy": {...}, "fingerprintOptions": {...} }
    → restServer.js: appx.put('/api/profiles/:id')      [dòng 352]
        → tìm existing profile, 404 nếu không có
        → build updatePayload: chỉ merge các field được gửi (partial update)
        → nếu có fingerprintOptions → generateFingerprint() → merge vào fingerprint
        → handlers.saveProfileInternal(updatePayload)
        → broadcastProfilesUpdated()
    → reply.send({ success: true })
```

---

### UC_14.04 — API: Delete Profile

```
HTTP DELETE /api/profiles/:id
    → restServer.js: appx.delete('/api/profiles/:id')   [dòng 505]
        → tìm profile, 404 nếu không có
        → handlers.stopProfileInternal(id)                — dừng nếu đang chạy
        → handlers.deleteProfileInternal(id)            [storage/profiles.js]
        → broadcastProfilesUpdated()
    → reply.send({ success: true })
```

---

## NHÓM UC_15 — API: Browser Control

### UC_15.01 — Launch Browser for a Profile

```
HTTP POST /api/browsers/:profileId/launch
Body: { "headless": false }
    → restServer.js: appx.post('/api/browsers/:profileId/launch')  [dòng 556]
        → parse headless (boolean hoặc string "true"/"false")
        → handlers.launchProfileInternal(profileId, { headless })
            [controllers/profiles.js] — xem luồng UC_08.04 ở trên
    → reply.send({ success: true, wsEndpoint })
```

---

### UC_15.02 — Close Browser for a Profile

```
HTTP POST /api/browsers/:profileId/close
    → restServer.js: appx.post('/api/browsers/:profileId/close')   [dòng 580]
        → handlers.stopProfileInternal(profileId)
            [controllers/profiles.js] — xem luồng UC_08.06 ở trên
    → reply.send({ success: true })
```

---

### UC_15.03 — Check if Browser is Running

```
HTTP GET /api/browsers/:profileId/status
    → restServer.js: appx.get('/api/browsers/:profileId/status')   [dòng 593]
        → runningProfiles.get(profileId)               [state/runtime.js]
    → reply.send({ running: true/false })
```

---

## NHÓM UC_16 — API: Browser Actions

**Cơ chế chung cho tất cả UC_16.xx:**

```
HTTP POST /api/browsers/:profileId/actions/{action-name}
    → restServer.js: mapAction("action.key")            [dòng 736]
        → performAction(profileId, actionName, params)  [engine/actions.js]
            → withPage(profileId)                         — lấy Playwright Page object
                → runningProfiles.get(profileId)
                → context.pages()[0]                      — trang đang active
            → gọi hàm tương ứng với actionName
            → appendLog(profileId, 'Action: ...')
            → return { success: true, ...data }
```

**Mapping action key → hàm trong actions.js:**

| UC | HTTP Route | action key | Hàm |
|---|---|---|---|
| UC_16.01 | POST .../navigate | nav.goto | page.goto(url) |
| UC_16.02 | POST .../reload | nav.reload | page.reload() |
| UC_16.03 | POST .../go-back | nav.back | page.goBack() |
| UC_16.04 | POST .../go-forward | nav.forward | page.goForward() |
| UC_16.05 | GET .../content | page.content | page.content() |
| UC_16.06 | GET .../page-info | page.info | page.url() + page.title() |
| UC_16.07 | POST .../screenshot | capture.screen | page.screenshot({fullPage}) |
| UC_16.08 | POST .../click | click.element | page.click(selector, {button}) |
| UC_16.09 | POST .../double-click | element.dblclick | page.dblclick(selector) |
| UC_16.10 | POST .../hover | hover | page.hover(selector) |
| UC_16.11 | POST .../focus | element.focus | page.focus(selector) |
| UC_16.12 | POST .../fill | input.fill | page.fill(selector, value) |
| UC_16.13 | POST .../press-key | keyboard.pressKey | page.press(selector, key) |
| UC_16.14 | POST .../scroll | page.scroll | page.evaluate(scrollBy) |
| UC_16.15 | POST .../set-viewport-size | viewport.set | page.setViewportSize({w,h}) |
| UC_16.16 | POST .../get-text | element.text | page.innerText(selector) |

---

## NHÓM UC_17 — API: Task

### UC_17.01 — List Tasks

```
HTTP GET /api/tasks?profileId=xxx
    → restServer.js: appx.get('/api/tasks')             [dòng 1018]
        → getTaskLogs()                                 [storage/taskLogs.js]
        → filter theo profileId nếu có query param
    → reply.send({ success: true, tasks: [...] })
```

---

### UC_17.02 — Create a New Task

```
HTTP POST /api/tasks
Body: { "profileId": "...", "name": "...", "scriptContent": "..." }
    → restServer.js: appx.post('/api/tasks')            [dòng 1031]
        → validate: profileId, name, scriptContent
        → kiểm tra profile tồn tại
        → tạo entry: { status: "queued", scriptContent, ... }
        → addTaskLog(entry)                             [storage/taskLogs.js]
        → broadcastTaskLogsUpdated()
    → reply.code(201).send(taskLog)
```

---

### UC_17.03 — Enqueue / Run a Task

```
HTTP POST /api/tasks/:id/run
    → restServer.js: appx.post('/api/tasks/:id/run')    [dòng 1079]
        → getTaskLogById(id)                              — tìm task
        → updateTaskLog(id, { status: "running" })
        → broadcastTaskLogsUpdated()
        → executeScript(profileId, scriptContent, opts) [engine/scriptRuntime.js]
            (fire-and-forget — không block HTTP response)
            → khi xong: updateTaskLog(id, { status: "completed"/"error" })
    → reply.send({ success: true, message: "Task started" })
```

---

### UC_17.04 — Cancel a Task

```
HTTP POST /api/tasks/:id/cancel
    → restServer.js: appx.post('/api/tasks/:id/cancel') [dòng 1127]
        → getTaskLogById(id)
        → isScriptRunning(task.profileId)               [engine/scriptRuntime.js]
            → nếu đang chạy: stopScript(profileId)
        → updateTaskLog(id, { status: "stopped", error: "Cancelled by user" })
        → broadcastTaskLogsUpdated()
    → reply.send({ success: true })
```

---

### UC_17.05 — Delete a Task Record

```
HTTP DELETE /api/tasks/:id
    → restServer.js: appx.delete('/api/tasks/:id')      [dòng 1150]
        → deleteTaskLog(id)                             [storage/taskLogs.js]
        → broadcastTaskLogsUpdated()
    → reply.send({ success: true })
```

---

## NHÓM UC_18 — API: Proxy

### UC_18.01 — List All Proxies

```
HTTP GET /api/proxies
    → restServer.js: appx.get('/api/proxies')           [dòng 1164]
        → getProxiesInternal()                          [storage/proxies.js]
    → reply.send({ success: true, proxies: [...] })
```

### UC_18.02 — Create Proxy

```
HTTP POST /api/proxies
Body: { "server": "http://ip:port", "username": "...", "password": "..." }
    → restServer.js: appx.post('/api/proxies')          [dòng 1193]
        → createProxyInternal(body)                     [storage/proxies.js]
            → gán id = uuid, createdAt = now
            → writeProxies([...existing, newProxy])
        → broadcastProxiesUpdated()
    → reply.code(201).send({ success: true, proxy })
```

### UC_18.03 — Update Proxy

```
HTTP PUT /api/proxies/:id
    → restServer.js: appx.put('/api/proxies/:id')       [dòng 1205]
        → updateProxyInternal(id, body)                 [storage/proxies.js]
        → broadcastProxiesUpdated()
```

### UC_18.04 — Delete Proxy

```
HTTP DELETE /api/proxies/:id
    → restServer.js: appx.delete('/api/proxies/:id')    [dòng 1219]
        → deleteProxyInternal(id)                       [storage/proxies.js]
        → broadcastProxiesUpdated()
```

---

## NHÓM UC_19 — API: Script

### UC_19.01 — List All Scripts

```
HTTP GET /api/scripts
    → restServer.js → listScriptsInternal()             [storage/scripts.js]
    → return { success: true, scripts: [...] }
```

### UC_19.02 — Create Script

```
HTTP POST /api/scripts
Body: { "name": "...", "code": "..." }
    → restServer.js → saveScriptInternal(body)          [storage/scripts.js]
        → gán id = uuid, createdAt = now
        → writeScripts([...existing, newScript])
```

### UC_19.03 — Update Script

```
HTTP PUT /api/scripts/:id
    → restServer.js → saveScriptInternal({ id, ...body })
        → tìm existing, merge, writeScripts()
```

### UC_19.04 — Delete Script and Cancel Cron Job

```
HTTP DELETE /api/scripts/:id
    → restServer.js → deleteScriptInternal(id)          [storage/scripts.js]
        → filter ra script cần xóa
        → nếu script có cronJob: hủy cron job liên quan [engine/automation.js]
        → writeScripts(remaining)
```

---

## NHÓM UC_20 — API: Fingerprint

### UC_20.01 — Generate Fingerprint (Not Saved)

```
HTTP GET /api/fingerprint/generate?os=windows&browser=chrome
    → restServer.js → generateFingerprint(opts)         [engine/fingerprintGenerator.js]
        → PRNG (Mulberry32) sinh dữ liệu ngẫu nhiên nhưng nhất quán
        → chọn ngẫu nhiên: OS, browser version, GPU, screen, timezone, language
        → trả về object fingerprint hoàn chỉnh
    → reply.send({ success: true, fingerprint, settings })
    (KHÔNG lưu vào bất kỳ profile nào)
```

### UC_20.02 — Generate and Save Fingerprint for Profile

```
HTTP POST /api/fingerprints/:profileId/generate
    → restServer.js
        → generateFingerprint(opts)                     [engine/fingerprintGenerator.js]
        → saveProfileInternal({ id: profileId, fingerprint: generated })
            [storage/profiles.js]
    → reply.send({ success: true, fingerprint })
```

---

## NHÓM UC_21 — API: Health

### UC_21.01 — Server Health Check

```
HTTP GET /api/health
    → restServer.js: appx.get('/api/health')            [dòng 141]
        (không cần API key, luôn public)
    → reply.send({ ok: true })
```

---

## Sơ đồ tổng quan luồng dữ liệu

```
                    ┌─────────────────────────────────────────┐
                    │           React UI (Renderer)            │
                    │  ProfileForm / ProfileList / ScriptsTab  │
                    └──────────────┬──────────────────────────┘
                                   │ window.electronAPI.xxx()
                                   │ [preload/index.js — context bridge]
                    ┌──────────────▼──────────────────────────┐
                    │     ipc/handlers.js (ipcMain.handle)     │
                    └──────────────┬──────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
  storage/profiles.js    controllers/profiles.js    engine/actions.js
  (CRUD JSON files)       (Playwright lifecycle)   (page interactions)
          │                        │                        │
          │               engine/fingerprintInit.js         │
          │               (inject scripts vào browser)      │
          │                        │                        │
          └────────────────────────▼────────────────────────┘
                          state/runtime.js
                    (runningProfiles Map in-memory)

                    ┌─────────────────────────────────────────┐
                    │   External Tool / Script / curl / Python │
                    └──────────────┬──────────────────────────┘
                                   │ HTTP Request
                    ┌──────────────▼──────────────────────────┐
                    │    api/restServer.js (Fastify routes)    │
                    │    http://localhost:3000/api/...         │
                    │    Swagger UI: /docs                     │
                    └──────────────┬──────────────────────────┘
                                   │ (cùng gọi vào handlers như IPC)
                    ┌──────────────▼──────────────────────────┐
                    │  Cùng tầng business logic bên dưới      │
                    │  storage/ + controllers/ + engine/       │
                    └─────────────────────────────────────────┘
```

---

## Ghi chú quan trọng

| Điểm | Giải thích |
|---|---|
| **Dual entry point** | Mọi chức năng đều có 2 đường vào: IPC (UI desktop) và REST API (external tool). Cả hai đều gọi vào cùng một hàm business logic |
| **Lock cơ chế** | `launchingProfiles` Set ngăn race condition khi click launch nhiều lần |
| **Broadcast** | Sau mỗi thay đổi, `broadcastXxxUpdated()` gửi event IPC đến tất cả cửa sổ Electron để React re-render |
| **Fire-and-forget** | UC_17.03 (run task) không block HTTP response — script chạy bất đồng bộ, kết quả cập nhật sau |
| **Fingerprint inject** | Luôn chạy TRƯỚC khi page load qua `context.addInitScript()` — website không thể can thiệp |
| **Safe mode** | Khi phát hiện Cloudflare, tắt `Object.defineProperty` overrides — chỉ giữ anti-automation cleanup |
