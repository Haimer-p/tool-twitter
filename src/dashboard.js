const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');
const { loadProfilesConfig } = require('./accountProfiles');

class Dashboard {
  constructor(database, config, onControl, accountsDir) {
    this.db = database;
    this.config = config;
    this.onControl = onControl || (() => {});
    this.accountsDir = accountsDir || path.join(process.cwd(), 'accounts');
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server);
    this.clients = new Set();
    this.statsInterval = null;
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
      try {
        const files = await fs.readdir(this.accountsDir);
        const accounts = files
          .filter((f) => f.endsWith('.json') && !f.endsWith('.config.json'))
          .map((f) => f.replace('.json', ''));
        res.json({ accounts });
      } catch {
        res.json({ accounts: [] });
      }
    });

    this.app.get('/api/account-profiles', auth, async (req, res) => {
      try {
        const profilesConfig = await loadProfilesConfig(this.accountsDir, this.config);
        res.json(profilesConfig);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/status', auth, (req, res) => {
      res.json({
        running: req.app.locals.botRunning || false,
        mode: req.app.locals.botMode || 'engage',
        useAi: req.app.locals.useAi || false,
        commentMode: req.app.locals.commentMode || 'rule',
        accountJobs: req.app.locals.accountJobs || [],
        botState: this.botState || null,
      });
    });

    this.app.post('/api/control/start', auth, async (req, res) => {
      const data = req.body || {};
      if (data.mode) {
        this.app.locals.botMode = data.mode;
        this.app.locals.useAi = !!data.useAi;
        this.app.locals.commentMode = data.useAi ? 'ai' : 'rule';
      }
      if (data.accountJobs?.length) {
        this.app.locals.botMode = 'multi';
        this.app.locals.accountJobs = data.accountJobs;
      }
      if (this.botState) {
        this.botState = { ...this.botState, ...data };
      }
      this.io.emit('control', { action: 'start', data });
      try {
        await this.onControl('start', data);
        res.json({ success: true, message: 'Start command sent' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/control/stop', auth, (req, res) => {
      this.io.emit('control', { action: 'stop' });
      this.onControl('stop');
      res.json({ success: true, message: 'Stop command sent' });
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
