# Finance & Accounting module — agreed design

Status: **design locked, not yet built.** Nothing in this file is live.

## Decisions taken

| # | Decision | Consequence |
|---|---|---|
| 1 | **"Paid" = the day the money left the account** | A cheque handed over is `cheque_issued`, not paid. It only hits the day book when the bank debits it. Keeps the daily match brutally simple. |
| 2 | **Cash in hand is a separate account** | Two accounts to reconcile: DCB Bank and Cash. Each gets its own daily close. |
| 3 | **DCB bank account only** (no IBS for now) | Model still supports many accounts, so IBS can be added without a migration. |
| 4 | **Anyone with Accounting access may enter; only an approver may close/lock a day.** Reopening is an approver action and is audit-logged. | Entry stays fast; the control sits at the close. |
| 5 | **A day may be closed with a difference**, but it needs a mandatory note and shows as a **red flag on the accounting dashboard** | Never silently absorbed. |

## The core idea

Two separate events, deliberately not merged:

- **Raising a payable / expense / advance** creates a **liability or claim** → feeds live Payables.
- **Marking it paid** creates a **money movement** → feeds the Day Book.

That separation is what turns a spend log into a real payables position.

## Daily reconciliation (per account, per day)

```
  Opening balance          (= previous day's ACTUAL closing, chained)
+ Receipts entered today
- Payments entered today
= EXPECTED closing
  ACTUAL closing           (typed from the bank / physical cash count)
-------------------------------------------------
  Difference               must be 0, else flag + mandatory note
```

## Schema (proposed)

```
cash_accounts        id, name, kind('bank'|'cash'), bank_name, account_no_masked,
                     opening_balance, opened_on, is_active

payables             id, vendor_id, vendor_invoice_no, invoice_date, due_date,
                     amount, gst_amount, total, category, note,
                     status('unpaid'|'cheque_issued'|'part_paid'|'paid'),
                     + approval_status / assigned_approver (existing pattern)

expense_categories   id, name, is_active
expenses             id, expense_date, category_id,
                     payee_kind('vendor'|'employee'|'other'), vendor_id, employee_id, payee_text,
                     amount, gst_amount, total, has_bill, bill_no, note,
                     + approval_status / assigned_approver

advances             id, party_kind('employee'|'vendor'), employee_id, vendor_id,
                     amount, issued_on, purpose, outstanding, status('open'|'settled')
advance_settlements  id, advance_id, ref_type('expense'|'repayment'), ref_id, amount, settled_on

cash_txns            id, account_id, direction('in'|'out'), txn_date, amount, mode,
                     ref_type('payable'|'expense'|'advance'|'salary'|'sales_invoice'|'transfer'|'other'),
                     ref_id, note, created_by
                     -- the single source of truth for money OUT

day_close            id, account_id, close_date,
                     opening, receipts, payments, expected_closing,
                     actual_closing, difference,
                     status('open'|'closed'), note, closed_by, closed_at
                     UNIQUE(account_id, close_date)
```

### Touching what already exists

- `payments` (AR receipts) stays as-is — the Day Book reads it as the "in" side.
  It needs one new column: `account_id` (which account the receipt landed in),
  defaulted to the DCB bank account. **No migration risk to live receivables.**
- Every movement also posts into the existing `accounting_entries` journal
  (`account`, `debit`, `credit`, `ref_type`, `ref_id`). Cheap now, painful to
  retrofit; gives a real trial balance later with no extra screens.

### Cash ↔ bank transfers

A cash withdrawal is `ref_type='transfer'`: one `out` row on Bank and one `in`
row on Cash, same date and amount, linked. Both days then reconcile.

## Build order

**Phase A — the smallest slice that proves the bank matches**
1. `cash_accounts` (DCB Bank + Cash) with opening balances
2. Supplier Invoices (payables) — enter, approve, mark paid
3. Expenses + categories
4. `cash_txns` + Day Book screen: opening → receipts → payments → expected vs actual
5. Close / lock a day (approver), reopen (approver, audit-logged)

**Phase B** — Advances + settlement against expenses/salary
**Phase C** — Live Payables & Receivables dashboard, ageing, red-flag panel
**Phase D** — Period lock, trial balance from `accounting_entries`

## Open question

**Navigation.** Either:
- (a) separate top-level **Accounting** tab — keeps Finance short, and separates
  customer-facing billing from internal cash; or
- (b) rename Finance → **Finance & Accounting**, with Expense Management as a
  sub-tab holding *Expenses* / *Supplier Invoices*.

Recommendation: (a), because Finance already carries 6 sub-tabs.

## Controls worth keeping

- Back-dated entries into a **closed** day must be refused until an approver reopens it.
- Day close is chained: opening is always the previous close, never typed.
- Accounting gets **its own permission** — bank balances and salary outflows are
  more sensitive than anything currently in the Suite.
