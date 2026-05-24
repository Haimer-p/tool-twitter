const logger = require('./logger');
const BrowserManager = require('./browser');
const { sleep, randomMs, parseTweetId, parseFollowerCount } = require('./utils');

const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  tweetText: 'article div[data-testid="tweetText"]',
  userName: 'article div[data-testid="User-Name"] a',
  like: 'button[data-testid="like"]',
  unlike: 'button[data-testid="unlike"]',
  retweet: 'button[data-testid="retweet"]',
  retweetConfirm: 'button[data-testid="retweetConfirm"]',
  reply: 'button[data-testid="reply"]',
  replyBox: 'div[data-testid="tweetTextarea_0"]',
  tweetButton: 'button[data-testid="tweetButton"]',
  follow: '[data-testid$="-follow"]:not([data-testid*="unfollow"])',
  unfollow: 'button[data-testid$="-unfollow"]',
  unfollowConfirm: 'button[data-testid="confirmationSheetConfirm"]',
};

const COMBO_MAP = {
  like: ['like'],
  retweet: ['retweet'],
  reply: ['reply'],
  follow: ['follow'],
  like_retweet: ['like', 'retweet'],
  like_reply: ['like', 'reply'],
  like_retweet_reply: ['like', 'retweet', 'reply'],
  like_follow: ['like', 'follow'],
  like_retweet_follow: ['like', 'retweet', 'follow'],
};

const COMBO_DELAY = { min: 3000, max: 8000 };

function buildCtx(profile, config) {
  return {
    accountName: profile.name,
    delays: profile.delays || config.delays,
    interactions: profile.interactions || config.interactions,
  };
}

class EngagementBot {
  constructor(browserManager, authManager, aiService, database, config, onActivity, parentBot = null) {
    this.browser = browserManager;
    this.auth = authManager;
    this.ai = aiService;
    this.db = database;
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://x.com';
    this.isRunning = true;
    this.parentBot = parentBot;
    this.onActivity = onActivity || (() => {});
  }

  isActive() {
    if (this.parentBot) return this.parentBot.isRunning;
    return this.isRunning;
  }

  async randomDelay(min, max) {
    await sleep(randomMs(min, max));
  }

  setupPageDialogs(page, ctx) {
    if (page._dialogHandlerSet) return;
    page._dialogHandlerSet = true;
    page.on('dialog', async (dialog) => {
      const msg = dialog.message()?.slice(0, 120) || dialog.type();
      logger.warn(`[${ctx.accountName}] Dialog auto-dismiss: ${msg}`);
      try {
        await dialog.accept();
      } catch {
        /* already handled */
      }
    });
  }

  async ensureComposerClosed(page, ctx) {
    const open = await page.$(SELECTORS.replyBox);
    if (!open) return;

    logger.info(`[${ctx.accountName}] Đóng hộp reply (tránh "Leave page?")`);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(400);

    const still = await page.$(SELECTORS.replyBox);
    if (still) {
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  }

  async safeGoto(page, url, ctx, label = 'navigate') {
    await this.ensureComposerClosed(page, ctx);

    const timeout = this.config.browser?.navigationTimeout || 60000;
    const retries = this.config.browser?.navigationRetries || 2;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `[${ctx.accountName}] ${label} (${attempt}/${retries}): ${error.message?.slice(0, 80)}`
        );
        if (attempt < retries) await sleep(3000);
      }
    }

    throw lastError;
  }

  async humanType(page, selector, text, ctx) {
    const typing = ctx.delays.typing || this.config.delays.typing;
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, {
      delay: randomMs(typing.min, typing.max),
    });
  }

  getReplyOptions(ctx) {
    const i = ctx.interactions;
    return {
      requiredIncludes: i.replyRequiredIncludes,
      maxLength: i.replyMaxLength,
    };
  }

  decideActionCombo(comboRatios) {
    if (!comboRatios) return ['like'];

    const entries = Object.entries(comboRatios);
    const rand = Math.random();
    let cumulative = 0;

    for (const [key, weight] of entries) {
      cumulative += weight;
      if (rand < cumulative && COMBO_MAP[key]) {
        return COMBO_MAP[key];
      }
    }

    return COMBO_MAP.like;
  }

  async searchTweets(page, keyword, ctx) {
    logger.info(`[${ctx.accountName}] Searching: ${keyword}`);
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;

    try {
      await this.safeGoto(page, url, ctx, `search "${keyword}"`);
    } catch (error) {
      logger.error(`[${ctx.accountName}] Search failed for "${keyword}": ${error.message}`);
      return [];
    }

    await this.randomDelay(2000, 4000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await this.randomDelay(
      ctx.delays.scroll?.min || this.config.delays.scroll.min,
      ctx.delays.scroll?.max || this.config.delays.scroll.max
    );

    const tweets = await page
      .$$eval(SELECTORS.tweet, (articles) =>
        articles
          .map((article) => {
            const link = article.querySelector('a[href*="/status/"]');
            return link ? link.href : null;
          })
          .filter(Boolean)
      )
      .catch(() => []);

    return [...new Set(tweets)];
  }

  async openTweetPage(page, tweetUrl, ctx) {
    await this.safeGoto(page, tweetUrl, ctx, 'open tweet');
    await this.randomDelay(
      ctx.delays.pageLoad?.min || 3000,
      ctx.delays.pageLoad?.max || 6000
    );
  }

  async getTweetContentFromPage(page) {
    try {
      const text = await page
        .$eval(SELECTORS.tweetText, (el) => el.textContent)
        .catch(() => '');
      const author = await page
        .$eval(SELECTORS.userName, (el) => {
          const href = el.getAttribute('href') || '';
          return href.split('/').filter(Boolean).pop() || 'user';
        })
        .catch(() => 'user');

      return { text: text || 'No content', author };
    } catch {
      return null;
    }
  }

  async getTweetContent(page, tweetUrl, ctx) {
    try {
      await this.openTweetPage(page, tweetUrl, ctx);
      return await this.getTweetContentFromPage(page);
    } catch {
      return null;
    }
  }

  async recordInteraction(data) {
    const saved = await this.db.saveInteractedTweet(data);
    if (!saved) return false;

    await this.db.updateDailyStats(data.accountName, data.interactionType);
    await this.db.logActivity({
      accountName: data.accountName,
      action: data.interactionType,
      target: data.tweetUrl || `@${data.authorUsername}`,
      success: true,
    });
    this.onActivity();
    return true;
  }

  async likeOnPage(page, meta, ctx) {
    try {
      const unlike = await page.$(SELECTORS.unlike);
      if (unlike) return false;

      const likeButton = await page.$(SELECTORS.like);
      if (!likeButton) return false;

      await likeButton.click();
      logger.info(`[${ctx.accountName}] Liked: ${meta.tweetUrl}`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'like',
        accountName: ctx.accountName,
        keywordUsed: meta.keyword,
      });
    } catch (error) {
      logger.error(`[${ctx.accountName}] Like error: ${error.message}`);
      return false;
    }
  }

  async retweetOnPage(page, meta, ctx) {
    try {
      const alreadyRetweeted = await page.$('[data-testid="unretweet"]');
      if (alreadyRetweeted) return false;

      const retweetButton = await page.$(SELECTORS.retweet);
      if (!retweetButton) return false;

      await retweetButton.click();
      await this.randomDelay(1000, 2000);

      const confirmButton =
        (await page.$(SELECTORS.retweetConfirm)) ||
        (await page.$('[data-testid="retweetConfirm"]'));
      if (!confirmButton) return false;

      await confirmButton.click();
      await this.randomDelay(1500, 2500);
      logger.info(`[${ctx.accountName}] Retweeted: ${meta.tweetUrl}`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'retweet',
        accountName: ctx.accountName,
        keywordUsed: meta.keyword,
      });
    } catch (error) {
      logger.error(`[${ctx.accountName}] Retweet error: ${error.message}`);
      return false;
    }
  }

  async fillReplyText(page, replyText, ctx) {
    await page.waitForSelector(SELECTORS.replyBox, { visible: true, timeout: 12000 });
    await page.click(SELECTORS.replyBox);
    await sleep(300);

    const filled = await page.evaluate(
      (selector, content) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const editable =
          el.closest('[contenteditable="true"]') ||
          el.querySelector('[contenteditable="true"]') ||
          el;
        editable.focus();
        editable.textContent = content;
        editable.dispatchEvent(
          new InputEvent('input', { bubbles: true, cancelable: true, data: content })
        );
        return (editable.textContent || '').length > 0;
      },
      SELECTORS.replyBox,
      replyText
    );

    if (!filled) {
      const fastCtx = {
        ...ctx,
        delays: { ...ctx.delays, typing: { min: 15, max: 35 } },
      };
      await this.humanType(page, SELECTORS.replyBox, replyText, fastCtx);
    }
  }

  async replyOnPage(page, replyText, meta, ctx, preloadedText = null) {
    const text = preloadedText || replyText;
    try {
      logger.info(`[${ctx.accountName}] AI reply: "${text.substring(0, 80)}..."`);

      const replyButton = await page.$(SELECTORS.reply);
      if (!replyButton) return false;

      await replyButton.click();
      await this.randomDelay(800, 1200);

      await this.fillReplyText(page, text, ctx);
      await this.randomDelay(500, 900);

      const postButton = await page.waitForSelector(SELECTORS.tweetButton, {
        visible: true,
        timeout: 10000,
      });
      if (!postButton) return false;

      await postButton.click();

      await page
        .waitForFunction(
          (sel) => !document.querySelector(sel),
          { timeout: 15000 },
          SELECTORS.replyBox
        )
        .catch(() => null);

      await this.randomDelay(1500, 2500);
      await this.ensureComposerClosed(page, ctx);

      logger.info(`[${ctx.accountName}] Replied: ${meta.tweetUrl.substring(0, 60)}...`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'reply',
        accountName: ctx.accountName,
        keywordUsed: meta.keyword,
        aiGeneratedReply: text,
      });
    } catch (error) {
      logger.error(`[${ctx.accountName}] Reply error: ${error.message}`);
      return false;
    } finally {
      await this.ensureComposerClosed(page, ctx);
    }
  }

  getFollowRules(ctx) {
    const i = ctx.interactions;
    const min = i.followMinFollowers ?? 0;
    const maxRaw = i.followMaxFollowers;
    const max = maxRaw && maxRaw > 0 ? maxRaw : null;
    const allowIfUnreadable =
      i.followAllowIfUnreadable ?? this.config.interactions.followAllowIfUnreadable ?? false;
    return { min, max, allowIfUnreadable };
  }

  async getProfileFollowerCount(page) {
    await page
      .waitForSelector('[data-testid="primaryColumn"]', { timeout: 15000 })
      .catch(() => null);
    await this.randomDelay(1500, 2500);

    const raw = await page
      .evaluate(() => {
        const pick = (str) => {
          if (!str || !/[\d]/.test(str)) return null;
          const m = str.match(/([\d.,]+[KMB]?)/i);
          return m ? m[1] : null;
        };

        for (const link of document.querySelectorAll('a[href*="/followers"]')) {
          const aria = link.getAttribute('aria-label') || '';
          if (/followers?/i.test(aria)) {
            const n = pick(aria.replace(/followers?/gi, ''));
            if (n) return n;
          }
          const text = link.innerText || '';
          const line = text.split('\n').find((l) => /followers?/i.test(l));
          if (line) {
            const n = pick(line);
            if (n) return n;
          }
        }

        const header =
          document.querySelector('[data-testid="UserProfileHeader_Items"]') ||
          document.querySelector('[data-testid="UserName"]')?.closest('div')?.parentElement;
        if (header) {
          const m = (header.innerText || '').match(/([\d.,]+[KMB]?)\s*Followers/i);
          if (m) return m[1];
        }

        const bodyMatch = (document.body.innerText || '').match(
          /([\d.,]+[KMB]?)\s+Followers/i
        );
        if (bodyMatch) return bodyMatch[1];

        return null;
      })
      .catch(() => null);

    return parseFollowerCount(raw);
  }

  async meetsFollowCriteria(page, username, ctx) {
    const { min, max, allowIfUnreadable } = this.getFollowRules(ctx);
    if (min <= 0 && !max) {
      return { ok: true, count: null };
    }

    const count = await this.getProfileFollowerCount(page);
    if (count === null) {
      if (allowIfUnreadable) {
        logger.warn(
          `[${ctx.accountName}] Không đọc follower @${username} — vẫn follow (followAllowIfUnreadable)`
        );
        return { ok: true, count: null, reason: 'unreadable_allowed' };
      }
      logger.warn(`[${ctx.accountName}] Không đọc được follower @${username} — bỏ qua follow`);
      return { ok: false, count: null, reason: 'unreadable' };
    }

    if (min > 0 && count < min) {
      return { ok: false, count, reason: 'below_min', min, max };
    }
    if (max && count > max) {
      return { ok: false, count, reason: 'above_max', min, max };
    }

    return { ok: true, count, min, max };
  }

  async followUser(page, username, meta, ctx) {
    try {
      if (await this.db.hasFollowedUser(username, ctx.accountName)) {
        return false;
      }

      await this.safeGoto(page, `${this.baseUrl}/${username}`, ctx, `profile @${username}`);
      await this.randomDelay(2000, 3000);

      const criteria = await this.meetsFollowCriteria(page, username, ctx);
      const { min, max } = this.getFollowRules(ctx);

      if (!criteria.ok) {
        if (criteria.reason === 'below_min') {
          logger.info(
            `[${ctx.accountName}] Skip follow @${username}: ${criteria.count} followers < min ${min}`
          );
        } else if (criteria.reason === 'above_max') {
          logger.info(
            `[${ctx.accountName}] Skip follow @${username}: ${criteria.count} followers > max ${max}`
          );
        }
        return false;
      }

      if (criteria.count !== null) {
        logger.info(
          `[${ctx.accountName}] @${username} có ${criteria.count} followers (min ${min || 0}${max ? `, max ${max}` : ''})`
        );
      }

      const followButton = await page.$(SELECTORS.follow);
      if (!followButton) return false;

      const buttonText = await page.evaluate((btn) => btn.textContent, followButton);
      if (buttonText && buttonText.toLowerCase().includes('following')) {
        return false;
      }

      await followButton.click();
      await this.randomDelay(1000, 1500);
      logger.info(`[${ctx.accountName}] Followed @${username}`);

      await this.db.saveFollowedUser({
        userId: username,
        username,
        accountName: ctx.accountName,
      });

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: username,
        content: meta.content,
        interactionType: 'follow',
        accountName: ctx.accountName,
        keywordUsed: meta.keyword,
      });
    } catch (error) {
      logger.error(`[${ctx.accountName}] Follow error: ${error.message}`);
      return false;
    }
  }

  async executeCombo(page, actions, meta, tweetContent, ctx) {
    let successCount = 0;
    let preparedReply = null;

    if (actions.includes('reply')) {
      preparedReply = await this.ai.generateReply(
        tweetContent.text,
        tweetContent.author,
        '',
        this.getReplyOptions(ctx)
      );
    }

    for (let i = 0; i < actions.length; i++) {
      if (!this.isActive()) break;

      const action = actions[i];
      let ok = false;

      switch (action) {
        case 'like':
          ok = await this.likeOnPage(page, meta, ctx);
          break;
        case 'retweet':
          ok = await this.retweetOnPage(page, meta, ctx);
          break;
        case 'reply':
          ok = await this.replyOnPage(page, preparedReply, meta, ctx, preparedReply);
          break;
        case 'follow':
          ok = await this.followUser(page, tweetContent.author, meta, ctx);
          break;
        default:
          break;
      }

      if (ok) successCount++;

      if (i < actions.length - 1) {
        await this.randomDelay(COMBO_DELAY.min, COMBO_DELAY.max);
      }
    }

    return successCount;
  }

  async checkAndUnfollow(page, ctx) {
    const accountName = ctx.accountName;
    const users = await this.db.getUsersToCheckFollowBack(
      accountName,
      ctx.interactions.followBackWaitDays || this.config.interactions.followBackWaitDays
    );

    for (const user of users) {
      if (!this.isActive()) break;

      logger.info(`[${accountName}] Checking follow-back: @${user.username}`);
      try {
        await this.safeGoto(page, `${this.baseUrl}/${user.username}`, ctx, 'unfollow check');
      } catch {
        continue;
      }
      await this.randomDelay(2000, 3000);

      const followButton = await page.$(SELECTORS.follow);
      let followedBack = false;

      if (followButton) {
        const buttonText = await page.evaluate((btn) => btn.textContent, followButton);
        followedBack =
          buttonText &&
          (buttonText.toLowerCase().includes('follow back') ||
            buttonText.toLowerCase().includes('follows you'));
      }

      if (followedBack) {
        await this.db.updateFollowBackStatus(user.userId, accountName, true);
        continue;
      }

      const unfollowButton = await page.$(SELECTORS.unfollow);
      if (unfollowButton) {
        await unfollowButton.click();
        await this.randomDelay(500, 1000);

        const confirmButton =
          (await page.$(SELECTORS.unfollowConfirm)) ||
          (await page.$('button[data-testid="unfollowConfirm"]'));
        if (confirmButton) {
          await confirmButton.click();
          await this.db.markUnfollowed(user.userId, accountName);
          await this.db.logActivity({
            accountName,
            action: 'unfollow',
            target: `@${user.username}`,
            success: true,
          });
        }
      }

      await this.randomDelay(
        ctx.delays.betweenActions.min,
        ctx.delays.betweenActions.max
      );
    }
  }

  async processAccount(accountProfile) {
    if (!this.isActive()) return;

    const ctx = buildCtx(accountProfile, this.config);
    const accountName = ctx.accountName;
    const interactions = ctx.interactions;

    logger.info(`Processing account: ${accountName}`);

    const todayCount = await this.db.getTodayInteractionCount(accountName);
    if (todayCount >= interactions.maxPerDay) {
      logger.warn(`${accountName}: daily limit reached (${todayCount})`);
      return;
    }

    const browserManager = new BrowserManager(this.config);
    await browserManager.launch();
    const page = await browserManager.newPage();
    this.setupPageDialogs(page, ctx);

    try {
      const loggedIn = await this.auth.login(page, accountName);
      if (!loggedIn) {
        logger.error(`Login failed: ${accountName}`);
        return;
      }

      await this.db.logActivity({
        accountName,
        action: 'login',
        target: accountName,
        success: true,
      });

      await this.randomDelay(3000, 5000);

      let interactionsThisRun = 0;
      const keywordsPerRun = interactions.keywordsPerRun || 6;
      const tweetsPerKeyword = interactions.tweetsPerKeyword || 8;
      const keywords = accountProfile.keywords || this.config.keywords;

      const shuffledKeywords = [...keywords].sort(() => Math.random() - 0.5);
      const selectedKeywords = shuffledKeywords.slice(0, keywordsPerRun);
      logger.info(`[${accountName}] Keywords: ${selectedKeywords.join(', ')}`);

      for (const keyword of selectedKeywords) {
        if (!this.isActive()) break;
        if (interactionsThisRun >= interactions.maxPerAccountPerRun) break;

        const tweetUrls = await this.searchTweets(page, keyword, ctx);
        logger.info(`[${accountName}] Found ${tweetUrls.length} tweets for "${keyword}"`);

        for (const tweetUrl of tweetUrls.slice(0, tweetsPerKeyword)) {
          if (!this.isActive()) break;
          if (interactionsThisRun >= interactions.maxPerAccountPerRun) break;

          const today = await this.db.getTodayInteractionCount(accountName);
          if (today >= interactions.maxPerDay) break;

          const tweetId = parseTweetId(tweetUrl);
          if (!tweetId) continue;

          if (await this.db.hasInteractedWithTweet(tweetId, accountName)) {
            continue;
          }

          const actions = this.decideActionCombo(interactions.comboRatios);
          logger.info(
            `[${accountName}] Combo [${actions.join(' + ')}] → ${tweetUrl.substring(0, 70)}...`
          );

          const tweetContent = await this.getTweetContent(page, tweetUrl, ctx);
          if (!tweetContent) continue;

          const meta = {
            tweetId,
            tweetUrl,
            author: tweetContent.author,
            content: tweetContent.text,
            keyword,
          };

          const tweetActions = actions.filter((a) => a !== 'follow');
          const includeFollow = actions.includes('follow');
          let count = 0;

          if (tweetActions.length > 0) {
            count += await this.executeCombo(page, tweetActions, meta, tweetContent, ctx);
          }

          if (includeFollow) {
            if (tweetActions.length > 0) {
              await this.randomDelay(COMBO_DELAY.min, COMBO_DELAY.max);
            }
            const followed = await this.followUser(page, tweetContent.author, meta, ctx);
            if (followed) count += 1;
          }

          interactionsThisRun += count;

          await this.randomDelay(
            ctx.delays.betweenActions.min,
            ctx.delays.betweenActions.max
          );
        }

        await this.randomDelay(
          ctx.delays.betweenSearchRounds?.min ||
            this.config.delays.betweenSearchRounds.min,
          ctx.delays.betweenSearchRounds?.max ||
            this.config.delays.betweenSearchRounds.max
        );
      }

      if (this.isActive()) {
        await this.checkAndUnfollow(page, ctx);
      }

      logger.info(`Done ${accountName}: ${interactionsThisRun} interactions this run`);
    } catch (error) {
      logger.error(`Error processing ${accountName}: ${error.message}`, { stack: error.stack });
      await this.db.logActivity({
        accountName,
        action: 'error',
        target: accountName,
        success: false,
        errorMessage: error.message,
      });
    } finally {
      await browserManager.close();
    }
  }

  async runParallelAccounts(profiles, maxConcurrent) {
    const queue = [...profiles];
    const concurrency = Math.min(maxConcurrent || 2, queue.length);

    logger.info(`Parallel run: ${queue.length} account(s), max ${concurrency} concurrent`);

    const worker = async () => {
      while (this.isRunning) {
        const profile = queue.shift();
        if (!profile) break;

        const workerBot = new EngagementBot(
          null,
          this.auth,
          this.ai,
          this.db,
          this.config,
          this.onActivity,
          this
        );
        await workerBot.processAccount(profile);
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
  }

  async runMultipleAccounts(accounts, keywords) {
    const profiles = accounts.map((name) => ({
      name,
      keywords: keywords || this.config.keywords,
      delays: this.config.delays,
      interactions: this.config.interactions,
      enabled: true,
    }));
    await this.runParallelAccounts(profiles, 1);
  }
}

module.exports = EngagementBot;
