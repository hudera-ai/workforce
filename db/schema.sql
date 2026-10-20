-- HUDERA Workforce · AI Employee Platform (multi-tenant PaaS)
PRAGMA foreign_keys = ON;

-- ---------- platform ----------
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  price_month REAL NOT NULL, included_tasks INTEGER NOT NULL, overage_per_task REAL NOT NULL, max_agents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
  industry TEXT, city TEXT, plan_id INTEGER REFERENCES plans(id),
  employees_count INTEGER, settings TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,         -- NULL = platform operator
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('platform','owner','hr_manager','finance_manager','sales_manager','viewer')),
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT, revoked INTEGER NOT NULL DEFAULT 0
);

-- ---------- AI employees ----------
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, name_ar TEXT NOT NULL, role TEXT NOT NULL,            -- role template key (hr, collections, sales)
  color TEXT NOT NULL DEFAULT '#3D5AFE', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  channels TEXT NOT NULL DEFAULT '["whatsapp"]',                              -- JSON array
  tools TEXT NOT NULL,                                                        -- JSON array of enabled tool names
  rules TEXT NOT NULL DEFAULT '{}',                                           -- JSON: approval thresholds, cadences …
  tone TEXT NOT NULL DEFAULT 'friendly', working_hours TEXT NOT NULL DEFAULT '08:00-17:00',
  supervisor_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS knowledge_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_role TEXT, lang TEXT NOT NULL DEFAULT 'ar', title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- company data the agents work on ----------
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emp_no TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, phone TEXT, email TEXT,
  department TEXT, title TEXT, manager_user_id INTEGER REFERENCES users(id), hire_date TEXT,
  basic_salary REAL, housing_allowance REAL, transport_allowance REAL,
  annual_leave_balance REAL NOT NULL DEFAULT 21, sick_days_used INTEGER NOT NULL DEFAULT 0,
  nationality TEXT, id_expiry TEXT, status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (tenant_id, emp_no)
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL, days REAL NOT NULL, reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source TEXT NOT NULL DEFAULT 'agent', decided_by INTEGER, decided_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL, addressed_to TEXT, lang TEXT NOT NULL DEFAULT 'ar', ref_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','rejected')),
  body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), issued_at TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL, department TEXT, requirements TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT, email TEXT, cv_text TEXT NOT NULL,
  score INTEGER, breakdown TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','shortlisted','interview','rejected','hired')),
  interview_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, contact_name TEXT, phone TEXT, email TEXT, segment TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_no TEXT NOT NULL, amount REAL NOT NULL, paid_amount REAL NOT NULL DEFAULT 0,
  issue_date TEXT NOT NULL, due_date TEXT NOT NULL, promise_date TEXT,
  reminders_count INTEGER NOT NULL DEFAULT 0, last_reminder_at TEXT, escalated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','disputed'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, source TEXT, need TEXT, size TEXT, budget TEXT, timeline TEXT, city TEXT,
  score INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','qualifying','qualified','meeting','won','lost','disqualified')),
  meeting_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS services_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL, keywords TEXT NOT NULL, price_from REAL
);

-- ---------- work the agents do ----------
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp', contact_type TEXT NOT NULL, contact_id INTEGER, contact_name TEXT NOT NULL, contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_human','resolved')),
  state TEXT,                                   -- JSON slot-filling state for multi-turn flows
  last_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), author TEXT NOT NULL CHECK (author IN ('contact','agent','human','system')),
  body TEXT NOT NULL, trace TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done','waiting_approval','escalated','failed')),
  conversation_id INTEGER, ref_type TEXT, ref_id INTEGER, minutes_saved REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, payload TEXT NOT NULL, approver_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER, decided_at TEXT, comment TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL,                         -- JSON {type, params}
  steps TEXT NOT NULL,                           -- JSON [{type, ...}]
  runs_count INTEGER NOT NULL DEFAULT 0, last_run_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL, log TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER, agent_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msgs_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_conv_tenant ON conversations(tenant_id, last_at);
CREATE INDEX IF NOT EXISTS idx_appr_tenant ON approvals(tenant_id, status);
