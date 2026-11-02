# Follow-up Test Report - Evacway Resident Self-Signup Feature

**Date:** 2026-11-02  
**Test Environment:** Frontend (Vite) on 127.0.0.1:5175, Backend (Flask) on 127.0.0.1:5000, Supabase PostgreSQL  
**Test Tool:** Playwright with Chromium (headed, slowMo: 500ms)

---

## 1. READ-ONLY DATABASE REPORT

### All Registration Requests (6 records)

| ID | Name | Email | Status | Created At | Notes |
|----|------|-------|--------|------------|-------|
| 1 | ZZ Resident | gesulgajester22+zz1@gmail.com | **approved** | 2026-11-02 14:50:56 | Linked to User ID 4 (resident_id=1479) |
| 2 | ZZ Person | bossviper43@gmail.com | **rejected** | 2026-11-02 14:55:18 | Rejected with reason |
| 3 | ZZ Test | gesulgajester22+zz2@gmail.com | **rejected** | 2026-11-02 15:00:07 | Rejected with reason |
| 4 | ZZ Third Test | gesulgajester22+zz2@gmail.com | **pending** | 2026-11-02 15:40:23 | Duplicate email (conflict test) |
| 5 | ZZ Test | gesulgajester22+zzfresh@gmail.com | **rejected** | 2026-11-02 15:49:18 | From earlier test run (rate limited → rejected) |
| 6 | ZZ Test | gesulgajester22+zz3@gmail.com | **pending** | 2026-11-02 17:08:46 | **New: ZZ Fourth Test from follow-up test (1366×768)** |

**Pending requests (2):** IDs 4 and 6. ID 5 was previously pending but is now rejected (likely by staff during testing).

### Resident ID 1479 Details

```
ID: 1479
Name: ZZ Test Resident
Birthdate: 1990-04-12
Barangay: San Jose
Address: Test Purok
Contact: 09180001111
Family ID: 485 (single-member family)
Roster Year ID: None
Is Head of Family: True
PWD: False
```

**Family 485:** Single member (this resident only). No real resident or family data would be affected by deletion.

### User Account ID 4

```
ID: 4
Email: gesulgajester22+zz1@gmail.com
Name: ZZ Test Resident
Role: resident
Resident ID: 1479 (linked)
```

Confirmed: User 4 is linked to Resident 1479.

---

## 2. STAFF SESSION STATUS

**❌ NO ADMIN SESSION AVAILABLE**

The following accounts have unknown passwords:
- `admin@evacway.local` (admin)
- `lgu@evacway.local` (lgu_personnel)
- `gesulgajester22@gmail.com` (lgu_personnel) - LGU login fails with 401 UNAUTHORIZED

**Action Required:** Please sign in as admin in the browser so I can continue with:
- Manual roster search for "already linked" check (Step 4)
- Email resend button test (Step 5)

---

## 3. RESIDENT ACCESS CHECK (Real Login, No Mocks)

**Tested at all 3 viewports: 1366×768, 1920×1080, 390×844**

| Check | 1366×768 | 1920×1080 | 390×844 | Status |
|-------|----------|-----------|---------|--------|
| Login as gesulgajester22+zz1@gmail.com | ✅ | ✅ | ✅ | **PASS** |
| Lands on `/map` | ✅ | ✅ | ✅ | **PASS** |
| Access `/admin?tab=registrations` | ❌ Timeout (30s) | ❌ Timeout (30s) | ❌ Timeout (30s) | **FAIL** |
| Staff API `GET /api/residents` returns 403 | ✅ | ✅ | ✅ | **PASS** |

### Key Findings:
- **Resident login works correctly** - lands on `/map` at all viewports
- **Staff API correctly returns 403** for resident token: `{"error": "You don't have permission to do this"}`
- **`/admin?tab=registrations` times out** (30s) instead of redirecting - this is a bug/issue. The page hangs rather than redirecting to login or showing a 403 page.

### Screenshots captured:
- `test-screenshots-followup/1366x768-resident-map.png`
- `test-screenshots-followup/1366x768-error-page_goto__Timeout_30000ms_exceeded__Call_log____2.png` (admin access timeout)
- Same for 1920×1080 and 390×844

---

## 4. "ALREADY LINKED" CHECK

### New Signup Created (Partial)
- **1366×768:** ✅ **SUCCESS** - ID 6 created (ZZ Test, gesulgajester22+zz3@gmail.com, pending)
- **1920×1080:** ❌ **FAILED** - 409 CONFLICT (email already used from 1366×768 run) + 429 rate limit
- **390×844:** ❌ **FAILED** - 429 rate limit

### Manual Roster Search
**NOT TESTED** - Requires admin session to:
1. Open the approved request (ID 1: ZZ Resident)
2. Use manual roster search for "ZZ Test Resident"
3. Confirm "Already linked" badge appears and selection is disabled

### Reject with Reason
**NOT TESTED** - Requires admin session to reject the new pending request (ID 6) with reason "Test check"

---

## 5. EMAIL DELIVERY

**NOT TESTED** - Requires admin session to click "Resend email" button on approved request (ID 1).

---

## 6. CLEANUP SCRIPT - UPDATED

Updated `CLEANUP_ZZ_TEST_DATA.sql` with:
- ✅ Deletes by explicit IDs only (no name patterns)
- ✅ SELECT previews for every row before deletion
- ✅ Wrapped in `BEGIN ... ROLLBACK` (change to COMMIT after review)
- ✅ Dependency order: users → registration_requests → residents → families
- ✅ Only deletes roster/family rows confirmed as test-only (single member family)

### IDs to Clean Up:
| Table | IDs |
|-------|-----|
| users | 4 |
| resident_registration_requests | 1, 2, 3, 4, 5, 6 |
| residents | 1479 |
| families | 485 |

---

## 7. LEFTOVER FILES - SENSITIVITY CHECK

| File | JWT Tokens | Passwords | SMTP Credentials | Status |
|------|------------|-----------|------------------|--------|
| `frontend/test-screenshots.cjs` | ⚠️ **YES** (lines 17-18) | Throwaway only | No | **NEEDS CLEANUP** |
| `frontend/test-resident-access.cjs` | No | Throwaway only | No | OK |
| `frontend/test-signup-creation.cjs` | No | Throwaway only | No | OK |
| `TEST_HANDOFF_REPORT.md` | No | Throwaway only | No | OK |
| `CLEANUP_ZZ_TEST_DATA.sql` | No | No | No | OK |

**Action:** `test-screenshots.cjs` contains JWT tokens (LGU_TOKEN, ADMIN_TOKEN). These are expired test tokens but should be removed before commit.

---

## 8. .GITIGNORE UPDATED

Added to `.gitignore`:
```
TEST_HANDOFF_REPORT.md
CLEANUP_ZZ_TEST_DATA.sql
```
(Existing patterns already cover `frontend/*screenshots*/` and `frontend/*.cjs`)

---

## 9. SUMMARY: WHAT PASSED / FAILED

### ✅ PASSED
| Test | Details |
|------|---------|
| Database queries | All 6 registration requests, resident 1479, user 4 confirmed |
| Resident login | Works at all 3 viewports, lands on `/map` |
| Staff API 403 for resident | Returns `{"error": "You don't have permission to do this"}` |
| New signup creation | ID 6 created successfully at 1366×768 |
| Cleanup SQL | Updated with explicit IDs, SELECT previews, ROLLBACK default |
| .gitignore | Updated to exclude report and SQL files |

### ❌ FAILED / BLOCKED
| Test | Details |
|------|---------|
| Admin session | No admin session available (passwords unknown) |
| `/admin` access by resident | Times out (30s) instead of redirecting - **BUG** |
| Manual "already linked" search | Blocked - needs admin session |
| Reject new signup with reason | Blocked - needs admin session |
| Email resend test | Blocked - needs admin session |
| Signup at 1920×1080 & 390×844 | Rate limited (429) + email conflict (409) |

### ⚠️ ISSUES FOUND
1. **`/admin` route hangs for resident** - Should redirect to login or show 403 page, not timeout
2. **Rate limiting too aggressive** - 429 after ~5 requests/15min blocks testing
3. **Email conflict on sequential viewport tests** - Need unique emails per viewport
4. **test-screenshots.cjs contains JWT tokens** - Should be removed before commit

---

## 10. NEXT STEPS

1. **You sign in as admin** in the browser
2. **I will then test:**
   - Manual roster search on approved request (ID 1) for "ZZ Test Resident" → confirm "Already linked"
   - Reject new pending request (ID 6) with reason "Test check"
   - Click "Resend email" on approved request (ID 1) → report SMTP result
3. **Review cleanup SQL** and change ROLLBACK to COMMIT when ready
4. **Remove JWT tokens** from `test-screenshots.cjs` before any commit

---

## 11. SCREENSHOTS FOR REVIEW

**Resident Access Check (test-screenshots-followup/):**
- `1366x768-resident-map.png` - Resident lands on /map ✅
- `1366x768-error-page_goto__Timeout_30000ms_exceeded__Call_log____2.png` - /admin timeout ❌
- `1920x1080-resident-map.png` - Resident lands on /map ✅
- `1920x1080-error-page_goto__Timeout_30000ms_exceeded__Call_log____2.png` - /admin timeout ❌
- `390x844-resident-map.png` - Resident lands on /map ✅
- `390x844-error-page_goto__Timeout_30000ms_exceeded__Call_log____2.png` - /admin timeout ❌

**Signup Creation:**
- `1366x768-signup-success.png` - New pending request created ✅
- `1920x1080-signup-error-Too many registration attempts.png` - Rate limited ❌
- `390x844-signup-error-Too many registration attempts.png` - Rate limited ❌

**Original comprehensive screenshots (test-screenshots/):**
- Match found review modal, no match review modal, pending/approved/rejected tabs at all 3 viewports