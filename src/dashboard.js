const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const { CONFIG_PATH, CONFIGS_DIR, listConfigFiles, resolveConfigPath } = require('./accountConfig');
const { SCREENSHOT_DIR } = require('./accountHealthCheck');
const { SCREENSHOT_DIR: APPEAL_SCREENSHOT_DIR } = require('./accountAppeal');
const logger = require('./logger');

class Dashboard {
  constructor(database, config, onControl) {
    this.db = database;
    this.config = config;
    this.onControl = onControl || (() => {});
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server);
    this.clients = new Set();
    this.statsInterval = null;
    this.botState = {
      configFile: 'accounts.config.json',
      runProfile: 'vua',
    };
    this.healthCheckState = {
      running: false,
      results: [],
      startedAt: null,
      completedAt: null,
    };
    this.appealState = {
      running: false,
      waitingCaptcha: false,
      currentAccount: null,
      results: [],
      startedAt: null,
      completedAt: null,
    };
  }

  emitAppealUpdate(payload) {
    this.io.emit('appeal-update', {
      ...payload,
      state: this.appealState,
      timestamp: new Date(),
    });
  }

  emitAppealComplete() {
    this.io.emit('appeal-complete', {
      state: this.appealState,
      timestamp: new Date(),
    });
  }

  emitAppealWaitingCaptcha(payload) {
    this.appealState.waitingCaptcha = !!payload?.waiting;
    this.appealState.currentAccount = payload?.accountName || this.appealState.currentAccount;
    this.io.emit('appeal-waiting-captcha', {
      ...payload,
      state: this.appealState,
      timestamp: new Date(),
    });
  }

  emitHealthCheckUpdate(payload) {
    this.io.emit('health-check-update', {
      ...payload,
      state: this.healthCheckState,
      timestamp: new Date(),
    });
  }

  emitHealthCheckComplete() {
    this.io.emit('health-check-complete', {
      state: this.healthCheckState,
      timestamp: new Date(),
    });
  }

  getBotStatusPayload(app) {
    const running = app?.locals?.botRunning || false;
    const stopping = app?.locals?.botStopping || false;
    return {
      running,
      stopping,
      healthCheckRunning: this.healthCheckState?.running || false,
      appealRunning: this.appealState?.running || false,
      appealWaitingCaptcha: this.appealState?.waitingCaptcha || false,
      activeConfigFile: this.botState?.configFile || 'accounts.config.json',
      runProfile: this.botState?.runProfile || 'vua',
    };
  }

  emitBotStatus() {
    this.io.emit('bot-status-update', {
      ...this.getBotStatusPayload(this.app),
      timestamp: new Date(),
    });
  }

  authMiddleware() {
    return (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
        return res.status(401).send('Authentication required');
      }

      const base64 = authHeader.split(' ')[1];
      const [username, password] = Buffer.from(base64, 'base64').toString().split(':');

      if (
        username === this.config.dashboard.username &&
        password === this.config.dashboard.password
      ) {
        return next();
      }

      return res.status(401).send('Invalid credentials');
    };
  }

  setupRoutes() {
    const auth = this.authMiddleware();

    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));

    this.app.get('/api/stats', auth, async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const stats = await this.db.getStats(startDate, endDate);
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/activities', auth, async (req, res) => {
      try {
        const limit = parseInt(req.query.limit, 10) || 50;
        const activities = await this.db.getRecentActivities(limit);
        res.json(activities);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/accounts', auth, async (req, res) => {
      const accountsDir = path.join(process.cwd(), 'accounts');
      try {
        const files = await fs.readdir(accountsDir);
        const accounts = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
        res.json({ accounts });
      } catch {
        res.json({ accounts: [] });
      }
    });

    this.app.get('/api/account-config', auth, async (req, res) => {
      try {
        const target = req.query.file
          ? resolveConfigPath(String(req.query.file))
          : resolveConfigPath(this.botState?.configFile || CONFIG_PATH);
        const raw = await fs.readFile(target, 'utf8').catch(() => null);
        if (!raw) {
          return res.json({ source: 'defaults', config: null });
        }
        res.json({
          source: path.relative(process.cwd(), target).replace(/\\/g, '/'),
          config: JSON.parse(raw),
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/config-files', auth, (_req, res) => {
      const files = listConfigFiles().map((absPath) =>
        path.relative(process.cwd(), absPath).replace(/\\/g, '/')
      );
      res.json({
        files,
        activeConfigFile: this.botState?.configFile || 'accounts.config.json',
        configDir: path.relative(process.cwd(), CONFIGS_DIR).replace(/\\/g, '/'),
      });
    });

    this.app.get('/api/status', auth, (req, res) => {
      res.json(this.getBotStatusPayload(req.app));
    });

    this.app.get('/api/health/results', auth, (req, res) => {
      res.json(this.healthCheckState);
    });

    this.app.get('/api/health/screenshots/:accountName', auth, async (req, res) => {
      const accountName = String(req.params.accountName || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!accountName) {
        return res.status(400).json({ error: 'Invalid account name' });
      }
      const filePath = path.join(SCREENSHOT_DIR, `${accountName}.png`);
      try {
        await fs.access(filePath);
        res.sendFile(filePath);
      } catch {
        res.status(404).json({ error: 'Screenshot not found' });
      }
    });

    this.app.post('/api/control/start', auth, (req, res) => {
      this.io.emit('control', { action: 'start', data: req.body });
      this.onControl('start', req.body);
      res.json({ success: true, message: 'Start command sent' });
    });

    this.app.post('/api/control/stop', auth, (req, res) => {
      this.io.emit('control', { action: 'stop' });
      this.onControl('stop');
      res.json({ success: true, message: 'Stop command sent' });
    });

    this.app.post('/api/control/login-account', auth, (req, res) => {
      this.io.emit('control', { action: 'login_account', data: req.body });
      this.onControl('login_account', req.body);
      res.json({ success: true, message: 'Login command sent' });
    });

    this.app.post('/api/control/health-check', auth, (req, res) => {
      this.io.emit('control', { action: 'health_check', data: req.body });
      this.onControl('health_check', req.body);
      res.json({ success: true, message: 'Health check started' });
    });

    this.app.get('/api/appeal/results', auth, (req, res) => {
      res.json(this.appealState);
    });

    this.app.get('/api/appeal/screenshots/:accountName', auth, async (req, res) => {
      const accountName = String(req.params.accountName || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!accountName) {
        return res.status(400).json({ error: 'Invalid account name' });
      }
      const filePath = path.join(APPEAL_SCREENSHOT_DIR, `${accountName}.png`);
      try {
        await fs.access(filePath);
        res.sendFile(filePath);
      } catch {
        res.status(404).json({ error: 'Screenshot not found' });
      }
    });

    this.app.post('/api/control/account-appeal', auth, (req, res) => {
      this.io.emit('control', { action: 'account_appeal', data: req.body });
      this.onControl('account_appeal', req.body);
      res.json({ success: true, message: 'Appeal started' });
    });

    this.app.post('/api/control/appeal-captcha-done', auth, (req, res) => {
      this.io.emit('control', { action: 'appeal_captcha_done', data: req.body });
      this.onControl('appeal_captcha_done', req.body);
      res.json({ success: true, message: 'Captcha done signal sent' });
    });

    this.app.get('/', auth, (req, res) => {
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
    });
  }

  setupSocket() {
    this.io.on('connection', (socket) => {
      logger.info('Dashboard client connected');
      this.clients.add(socket);

      socket.on('control', (data) => {
        if (data?.action) this.onControl(data.action, data);
      });

      socket.on('disconnect', () => {
        this.clients.delete(socket);
      });
    });
  }

  async sendStatsUpdate() {
    try {
      const stats = await this.db.getStats();
      const activities = await this.db.getRecentActivities(20);

      this.io.emit('stats-update', {
        stats: stats.totals,
        chartData: stats.stats.map((s) => (s.toObject ? s.toObject() : s)),
        recentActivities: activities.map((a) => (a.toObject ? a.toObject() : a)),
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error(`Stats update error: ${error.message}`);
    }
  }

  async start(port) {
    this.setupRoutes();
    this.setupSocket();

    this.statsInterval = setInterval(() => {
      if (this.clients.size > 0) {
        this.sendStatsUpdate();
      }
    }, 10000);

    return new Promise((resolve, reject) => {
      this.server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `Port ${port} dang duoc dung. Dong process cu (netstat -ano | findstr :${port}) hoac doi DASHBOARD_PORT trong .env`
            )
          );
        } else {
          reject(err);
        }
      });
      this.server.listen(port, () => {
        logger.info(`Dashboard: http://localhost:${port}`);
        resolve();
      });
    });
  }

  async close() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    return new Promise((resolve) => {
      if (this.server) {
        this.io.close();
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

module.exports = Dashboard;
