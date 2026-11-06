# Flowboard — Node.js + MySQL starter for CyberPanel

A working Express app with a responsive dashboard and CRUD task management stored in MySQL/MariaDB. **PHP itself is not a database**: CyberPanel's MySQL/MariaDB databases can be accessed both from PHP apps and from this Node.js app, and managed through phpMyAdmin.

## Contents

- `server.js` — Express server and parameterized MySQL queries
- `public/` — responsive dashboard frontend, no frontend build required
- `sql/schema.sql` — tasks database table
- `.env.example` — database connection configuration template
- `deploy/flowboard.service` — auto-restarting systemd service
- `deploy/vhost-proxy.conf` — OpenLiteSpeed reverse proxy blocks

## Quick local start

1. Install Node.js 20+ and MySQL/MariaDB.
2. Create a database and a limited-privilege user. In phpMyAdmin select that database and import `sql/schema.sql`.
3. Copy `.env.example` to `.env`, set the actual database values. For development you may set `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=development`.
4. Run `npm install` and `npm start`.
5. Open `http://127.0.0.1:3000` and check `http://127.0.0.1:3000/api/health`.

## CyberPanel / AlmaLinux deployment

**Example:** `app.example.com` on your server → OpenLiteSpeed → Node.js on localhost:3000 → MariaDB/MySQL.

### 1. Domain, DNS and DB

- Create `app.example.com` as a website in CyberPanel and point its DNS A record to the VPS public IPv4 address.
- In CyberPanel, go to **Databases & FTP → Create/Delete Database** (menu varies by version). Select the website, create a database and user with a strong unique password. **Copy the FULL, prefixed database name and username** shown by CyberPanel.
- Open CyberPanel **phpMyAdmin**, select that database, and **Import** `sql/schema.sql`. The SQL does not create a database, only a `tasks` table.

### 2. Install Node.js and upload app

SSH as a sudo-capable user:

```bash
sudo dnf install -y nodejs npm unzip
node -v
which node
sudo useradd --system --user-group --create-home --home-dir /opt/flowboard --shell /sbin/nologin flowboard
```

Upload the ZIP to your server via SFTP, e.g. `/root/cyberpanel-node-mysql.zip`, then:

```bash
sudo mkdir -p /opt/flowboard
sudo unzip /root/cyberpanel-node-mysql.zip -d /opt/flowboard
sudo chown -R flowboard:flowboard /opt/flowboard
cd /opt/flowboard
sudo cp .env.example .env
sudo nano .env
sudo chmod 600 .env
sudo chown flowboard:flowboard .env
sudo -u flowboard npm install --omit=dev
```

Set `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` to the actual CyberPanel credentials; `HOST=127.0.0.1`, `PORT=3000`. `npm ci --omit=dev` is preferable after generating and committing a lock file.

Test directly:

```bash
cd /opt/flowboard
sudo -u flowboard npm start
# From another SSH session:
curl -i http://127.0.0.1:3000/api/health
```

The expected response is `{"status":"ok","database":"connected"}`. Press Ctrl+C in the first session after testing. If you get a 503 error, check the DB credentials and whether the SQL was imported.

### 3. Enable systemd

```bash
sudo cp /opt/flowboard/deploy/flowboard.service /etc/systemd/system/flowboard.service
# IMPORTANT: check path of node with `which node` and adjust ExecStart if necessary.
sudo systemctl daemon-reload
sudo systemctl enable --now flowboard
sudo systemctl status flowboard --no-pager
sudo journalctl -u flowboard -n 50 --no-pager
```

### 4. Connect OpenLiteSpeed (proxy)

- CyberPanel → **Websites → List Websites → Manage → vHost Conf / Web Server Config** (exact wording varies by version).
- **Back up the existing vhost config** before editing. It is often `/usr/local/lsws/conf/vhosts/app.example.com/vhost.conf`, but inspect your server before assuming the path.
- Append the two blocks from `deploy/vhost-proxy.conf` to your EXISTING vhost configuration. If another `context /` exists, adjust it instead of duplicating it. Do not erase existing SSL, PHP, logging, or listener settings.
- Restart OpenLiteSpeed:

```bash
sudo systemctl restart lsws
curl -i http://app.example.com/api/health
```

If the proxy does not work, check the OpenLiteSpeed error logs: `sudo tail -n 100 /usr/local/lsws/logs/error.log`. On SELinux-enforcing systems, investigate AVC denials (`sudo ausearch -m AVC -ts recent`) before changing policy. Where appropriate, `sudo setsebool -P httpd_can_network_connect 1` can allow web-service outbound connections; this is broader than a single port, so enable it only if needed.

### 5. HTTPS SSL

- CyberPanel → **SSL / Security → Manage SSL** (depends on version) → select your domain → **Issue SSL**.
- Verify public DNS, ports 80/443, and any IPv6 AAAA records if issuance fails.
- Confirm HTTPS:

```bash
curl -i https://app.example.com/api/health
```

Use CyberPanel's HTTPS redirect feature if available. Preserve ACME challenge access when custom rewrite rules are added. You do **not** need to expose port 3000 publicly.

### 6. Logs and debugging

```bash
sudo systemctl status flowboard --no-pager
sudo journalctl -u flowboard -f
sudo systemctl status lsws --no-pager
sudo tail -n 100 /usr/local/lsws/logs/error.log
sudo ss -lntp | grep ':3000'
curl -i http://127.0.0.1:3000/api/health
curl -i https://app.example.com/api/health
```

- **Database unavailable / HTTP 503**: DB credentials, service running, phpMyAdmin schema import, MariaDB grants and localhost networking.
- **Proxy 503**: systemd service stopped, wrong port or external processor configuration, SELinux denials.
- **404/default site**: virtual host mapping or proxy context not applied.
- **SSL errors**: DNS records, ports 80/443, CyberPanel certificate status.
- **`Access denied for user`**: use the full prefixed CyberPanel DB username; confirm password and permissions.
- **`Table '...tasks' doesn't exist`**: import `sql/schema.sql` into the correct selected database.

### Updating code

Upload changed files, re-install dependencies if `package.json` changes, then `sudo systemctl restart flowboard` and check `sudo journalctl -u flowboard -n 30 --no-pager`.

## API

- `GET /api/health` — tests database connectivity
- `GET /api/tasks` — lists newest 200 tasks
- `POST /api/tasks` — creates task `{ "title": "...", "description": "..." }`
- `PATCH /api/tasks/:id` — changes status `{ "status": "todo" | "in_progress" | "done" }`
- `DELETE /api/tasks/:id` — deletes task

## Security before a public production launch

This is a learning/starter app; **it has no login/authentication**. Anyone who can reach the site can modify and delete tasks. Add accounts/authentication, authorization, rate limiting, CSRF protections as needed, backups, monitoring, and a narrower database permission scope before storing sensitive or shared business data. Keep `.env` private and outside the public web root. Parameterized SQL queries are used for data inputs.

Useful documentation:
- https://docs.openlitespeed.org/config/reverseproxy/
- https://cyberpanel.net/KnowledgeBase/home/database-in-cyberpanel/
