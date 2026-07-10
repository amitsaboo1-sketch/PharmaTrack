# Wireframes — key screens

Design language: clean light enterprise. Sidebar (role-filtered) + topbar. Cards on `#f7f8fa` canvas, white surfaces, 1px `#e5e7eb` borders, 10px radius. Accent emerald `#059669` (positive/ROI), indigo `#4f46e5` (primary actions), amber (pending), red (rejected/over-budget). Typography: Inter/Plus Jakarta Sans. Minimal clicks: every list row opens detail; primary action is always top-right.

## 1. Login
```
┌────────────────────────────────────────────┐
│                 [◆ logo]                   │
│        PharmaTrack ROI Platform            │
│  ┌──────────────────────────────────────┐  │
│  │ Email    [______________________]    │  │
│  │ Password [______________________]    │  │
│  │        [ Sign in ]                   │  │
│  │  demo: rep / manager one-click chips │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

## 2. Shell (all screens)
```
┌──────────┬───────────────────────────────────────────────┐
│ ◆ Pharma │ Page title                    🔔(3)  Rohan ▾   │
│  Track   ├───────────────────────────────────────────────┤
│──────────│                                               │
│ Dashboard│                <page content>                 │
│ Activities                                               │
│ Approvals (HO)                                           │
│ Doctors  │                                               │
│ Chemists │                                               │
│ Mappings (sales)                                         │
│ Verification (HO)                                        │
│ Sales Import (HO)                                        │
│ ROI Analytics                                            │
│ Reports  │                                               │
│ Audit (HO)                                               │
│ Settings │                                               │
└──────────┴───────────────────────────────────────────────┘
```

## 3. Executive dashboard (HO)
```
┌ Total Spend ┐┌ Activities ┐┌ Pending ┐┌ Blended ROI ┐
│ ₹3.2L  ▲12% ││ 24 (18 ✓)  ││ 3  ⚠    ││ +64%  ▲     │
└─────────────┘└────────────┘└─────────┘└─────────────┘
┌ Monthly Spend vs Incremental Sales (bar+line) ┐┌ Pending approvals ┐
│ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇      ─── incremental       ││ • CME Saket  ₹12k │
└───────────────────────────────────────────────┘│   [Review]        │
┌ Spend by type (donut) ┐┌ ROI by brand (bars) ┐ │ • RTM Onco  ₹25k  │
└───────────────────────┘└─────────────────────┘ └───────────────────┘
┌ Rep leaderboard: name | activities | spend | incr sales | ROI% ┐
```

## 4. Sales dashboard (MR)
```
┌ June target ring 103% ┐┌ YTD ring 98% ┐┌ My ROI +71% ┐┌ Pending 1 ┐
┌ My activities (status chips: draft/submitted/approved/executed) ┐
│ CME Beta Blockers · ₹15k est · Apr 15 · ✅ executed  [open]     │
├ Top doctors by incremental sales ┐┌ Expense by category (donut) ┤
```

## 5. Propose activity (modal, 2 steps)
```
Step 1 Details: name | type ▾ | brand ▾ | product ▾ | date | venue |
                estimated cost | expected sales | objective
Step 2 Targets: [search doctors…] ☑ Dr Patel (A) ☑ Dr Deshmukh (B)
                [search chemists…] ☑ Bandra Medicos   [+ Add new doctor]
        [Save draft]                     [Submit for approval]
```

## 6. Activity detail
```
← Activities        CME on Beta Blockers          [status: APPROVED]
Timeline: proposed 02 Apr (Rohan) → approved 03 Apr (Dr Verma) → …
┌ Proposal ─────────────┐ ┌ Execution ───────────────────────────┐
│ type/brand/venue/est  │ │ actual date/venue/cost               │
│ proposed attendees    │ │ expense breakup table (9 categories) │
└───────────────────────┘ │ attendee tick-list ☑☐ + remarks      │
HO panel: [Approve] [Return] [Reject]  remarks[________]         │
ROI panel (post-execution): cost 16.5k · incr 28.4k · ROI +72%   │
```

## 7. Sales import wizard (HO)
```
[1 Upload]──[2 Validate]──[3 Preview]──[4 Commit]
Drop CSV or [browse]     [Download template]
Validation report: 142 ok · 3 errors
  ✖ row 17: unknown HCP id HCP999
  ⚠ month 2026-06 already uploaded in batch #4 (rollback first)
Preview (50 rows) → [Commit 142 rows]
History: batch # | file | month | rows | by | at | [Rollback]
```

## 8. Doctor 360
```
Dr. Sandeep Patel · Cardiologist · Class A · ★ potential 9/10  [verified]
┌ Spend ₹21k ┐┌ Incr sales ₹38k ┐┌ ROI +81% ┐┌ Activities 4 ┐
Sales trend (line, 12 mo, activity markers ▲)
Engagement timeline: Apr CME ✓ attended · Feb gifting ✗ absent …
Mapped chemists: Bandra Medicos · Khar Pharmacy [manage]
```

## 9. Verification queue (HO)
```
Pending field accounts (2)
• "Dr. R. Iyer" — Ortho, added by Rohan 02 Jul
  [Approve to master]  or merge into: [search master ▾] [Merge]
```
