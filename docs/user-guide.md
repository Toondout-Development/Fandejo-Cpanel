# User Guide — Fandejo Database Workbench

Welcome to **Fandejo**, a fast, lightweight database administration workbench designed for MariaDB, MySQL, and SQLite3.

---

## 1. Accessing Fandejo in cPanel

1. Log into your **cPanel** dashboard.
2. In the search bar or under the **Databases** section, click the **Fandejo** icon.
3. Fandejo will launch in a new browser tab and automatically sign you in via **Single Sign-On (SSO)**.

---

## 2. Navigating the Interface

### Engine Switcher (Header)
Located at the top right of the sidebar:
- **`[ 🐬 MySQL ]`**: Active MariaDB/MySQL mode. Connects to your cPanel databases.
- **`[ 🗄️ SQLite ]`**: Active SQLite3 mode. Switches to your sandboxed SQLite catalog.
- **`[ ◐ ]`**: Toggle between Dark and Light themes.
- **`[ ⏻ ]`**: Sign out or reset current session.

### Sidebar Database Tree
- Displays all databases available to your account.
- Click a database name to expand its tables and views.
- Use the **Filter...** box at the top of the sidebar to quickly search across all databases and tables.

---

## 3. Working with MariaDB & MySQL

### Browsing & Editing Data
- Click any table in the sidebar to open the **Browse** view.
- Double-click any cell to edit data inline and press `Enter` to commit changes.
- Click column headers to sort ascending or descending.
- Use the quick filter bar to perform complex queries without writing SQL.

### Bulk Table Operations
- In the **Tables** tab of any database, checkboxes are available on each table row.
- Check the **master checkbox** in the header to select all tables.
- Use the action bar to:
  - **Empty / Truncate Selected:** Wipes all rows while keeping structure intact.
  - **Drop Selected:** Permanently removes the selected tables.

### Running SQL Queries
- Click the **SQL** tab in the top navigation bar.
- Enter your query in the code editor.
- Press `Ctrl + Enter` (or `Cmd + Enter`) to execute immediately.

---

## 4. Working with SQLite3 (Sandboxed Catalog)

Fandejo provides first-class support for SQLite3 directly within cPanel:

1. Click the **`[ 🐬 MySQL ]`** button in the header to switch to **`[ 🗄️ SQLite ]`**.
2. Fandejo scans your home directory (`/home/username/public_html`, `/home/username/data`, etc.) for `.sqlite`, `.sqlite3`, and `.db` files.
3. You can create new SQLite databases, inspect schemas, run queries, and optimize databases using `VACUUM` and `ANALYZE`.
4. Your SQLite files are completely private and isolated to your account.
