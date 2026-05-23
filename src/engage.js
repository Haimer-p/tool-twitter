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

class EngagementBot {
  constructor(browserManager, authManager, aiService, database, config, onActivity) {
    this.browser = browserManager;
    this.auth = authManager;
    this.ai = aiService;
    this.db = database;
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://x.com';
    this.isRunning = true;
    this.currentAccount = null;
    this.accountDelays = config.delays;
    this.accountInteractions = config.interactions;
    this.onActivity = onActivity || (() => {});
  }

  setAccountContext(profile) {
    this.currentAccount = profile.name;
    this.accountDelays = profile.delays || this.config.delays;
    this.accountInteractions = profile.interactions || this.config.interactions;
  }

  async randomDelay(min, max) {
    await sleep(randomMs(min, max));
  }

  async humanType(page, selector, text) {
    const typing = this.accountDelays.typing || this.config.delays.typing;
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, {
      delay: randomMs(typing.min, typing.max),
    });
  }

  decideActionCombo(comboRatios) {
    const ratios = comboRatios || this.accountInteractions.comboRatios || this.config.interactions.comboRatios;
    if (!ratios) return ['like'];

    const entries = Object.entries(ratios);
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

  async searchTweets(page, keyword) {
    logger.info(`[${this.currentAccount}] Searching: ${keyword}`);
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await this.randomDelay(
      this.accountDelays.scroll?.min || this.config.delays.scroll.min,
      this.accountDelays.scroll?.max || this.config.delays.scroll.max
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

  async openTweetPage(page, tweetUrl) {
    await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(
      this.accountDelays.pageLoad?.min || 3000,
      this.accountDelays.pageLoad?.max || 6000
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

  async getTweetContent(page, tweetUrl) {
    try {
      await this.openTweetPage(page, tweetUrl);
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
      details: data.combo ? { combo: data.combo } : undefined,
    });
    this.onActivity();
    return true;
  }

  async likeOnPage(page, meta) {
    try {
      const unlike = await page.$(SELECTORS.unlike);
      if (unlike) return false;

      const likeButton = await page.$(SELECTORS.like);
      if (!likeButton) return false;

      await likeButton.click();
      logger.info(`[${this.currentAccount}] Liked: ${meta.tweetUrl}`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'like',
        accountName: this.currentAccount,
        keywordUsed: meta.keyword,
      });
    } catch (error) {
      logger.error(`Like error: ${error.message}`);
      return false;
    }
  }

  async retweetOnPage(page, meta) {
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
      logger.info(`[${this.currentAccount}] Retweeted: ${meta.tweetUrl}`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'retweet',
        accountName: this.currentAccount,
        keywordUsed: meta.keyword,
      });
    } catch (error) {
      logger.error(`Retweet error: ${error.message}`);
      return false;
    }
  }

  async replyOnPage(page, replyText, meta) {
    try {
      logger.info(`[${this.currentAccount}] AI reply: "${replyText.substring(0, 80)}..."`);

      const replyButton = await page.$(SELECTORS.reply);
      if (!replyButton) return false;

      await replyButton.click();
      await this.randomDelay(1000, 1500);

      const replyBox = await page.$(SELECTORS.replyBox);
      if (!replyBox) return false;

      await replyBox.click();
      await this.humanType(page, SELECTORS.replyBox, replyText);
      await this.randomDelay(1000, 1500);

      const postButton = await page.$(SELECTORS.tweetButton);
      if (!postButton) return false;

      await postButton.click();
      logger.info(`[${this.currentAccount}] Replied: ${meta.tweetUrl.substring(0, 60)}...`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'reply',
        accountName: this.currentAccount,
        keywordUsed: meta.keyword,
        aiGeneratedReply: replyText,
      });
    } catch (error) {
      logger.error(`Reply error: ${error.message}`);
      return false;
    }
  }

  getFollowRules() {
    const i = this.accountInteractions;
    const min = i.followMinFollowers ?? 0;
    const maxRaw = i.followMaxFollowers;
    const max = maxRaw && maxRaw > 0 ? maxRaw : null;
    return { min, max };
  }

  async getProfileFollowerCount(page) {
    const raw = await page
      .evaluate(() => {
        const tryParse = (str) => {
          if (!str || !/[\d]/.test(str)) return null;
          return str.trim();
        };

        const links = document.querySelectorAll('a[href*="/followers"]');
        for (const link of links) {
          const aria = link.getAttribute('aria-label') || '';
          if (/follower/i.test(aria)) {
            const fromAria = tryParse(aria.split(/follower/i)[0]);
            if (fromAria) return fromAria;
          }
          for (const span of link.querySelectorAll('span')) {
            const t = tryParse(span.textContent);
            if (t && /[\d.,]+[KMB]?/i.test(t)) return t;
          }
        }

        const profileHeader = document.querySelector('[data-testid="UserProfileHeader_Items"]');
        if (profileHeader) {
          const text = profileHeader.innerText || '';
          const m = text.match(/([\d.,]+[KMB]?)\s*Followers/i);
          if (m) return m[1];
        }

        return null;
      })
      .catch(() => null);

    return parseFollowerCount(raw);
  }

  async meetsFollowCriteria(page, username) {
    const { min, max } = this.getFollowRules();
    if (min <= 0 && !max) {
      return { ok: true, count: null };
    }

    const count = await this.getProfileFollowerCount(page);
    if (count === null) {
      logger.warn(`[${this.currentAccount}] Không đọc được follower @${username}`);
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

  async followUser(page, username, meta) {
    try {
      if (await this.db.hasFollowedUser(username, this.currentAccount)) {
        return false;
      }

      await page.goto(`${this.baseUrl}/${username}`, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 3000);

      const criteria = await this.meetsFollowCriteria(page, username);
      const { min, max } = this.getFollowRules();

      if (!criteria.ok) {
        if (criteria.reason === 'below_min') {
          logger.info(
            `[${this.currentAccount}] Skip follow @${username}: ${criteria.count} followers < min ${min}`
          );
        } else if (criteria.reason === 'above_max') {
          logger.info(
            `[${this.currentAccount}] Skip follow @${username}: ${criteria.count} followers > max ${max}`
          );
        }
        return false;
      }

      if (criteria.count !== null) {
        logger.info(
          `[${this.currentAccount}] @${username} có ${criteria.count} followers (min ${min || 0}${max ? `, max ${max}` : ''})`
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
      logger.info(`[${this.currentAccount}] Followed @${username}`);

      await this.db.saveFollowedUser({
        userId: username,
        username,
        accountName: this.currentAccount,
      });

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl: meta.tweetUrl,
        authorUsername: username,
        content: meta.content,
        interactionType: 'follow',
        accountName: this.currentAccount,
        keywordUsed: meta.keyword,
      });
    } catch (error) {
      logger.error(`Follow error: ${error.message}`);
      return false;
    }
  }

  async executeCombo(page, actions, meta, tweetContent) {
    let successCount = 0;

    for (let i = 0; i < actions.length; i++) {
      if (!this.isRunning) break;

      const action = actions[i];
      let ok = false;

      switch (action) {
        case 'like':
          ok = await this.likeOnPage(page, meta);
          break;
        case 'retweet':
          ok = await this.retweetOnPage(page, meta);
          break;
        case 'reply': {
          const replyText = await this.ai.generateReply(
            tweetContent.text,
            tweetContent.author
          );
          ok = await this.replyOnPage(page, replyText, meta);
          break;
        }
        case 'follow':
          ok = await this.followUser(page, tweetContent.author, meta);
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

  async checkAndUnfollow(page, accountName, delays) {
    const accountDelays = delays || this.accountDelays;
    const users = await this.db.getUsersToCheckFollowBack(
      accountName,
      this.accountInteractions.followBackWaitDays ||
        this.config.interactions.followBackWaitDays
    );

    for (const user of users) {
      if (!this.isRunning) break;

      logger.info(`[${accountName}] Checking follow-back: @${user.username}`);
      await page.goto(`${this.baseUrl}/${user.username}`, { waitUntil: 'domcontentloaded' });
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
        accountDelays.betweenActions.min,
        accountDelays.betweenActions.max
      );
    }
  }

  async processAccount(accountProfile) {
    if (!this.isRunning) return;

    const accountName = accountProfile.name;
    this.setAccountContext(accountProfile);

    logger.info(`Processing account: ${accountName}`);
    const interactions = this.accountInteractions;

    const todayCount = await this.db.getTodayInteractionCount(accountName);
    if (todayCount >= interactions.maxPerDay) {
      logger.warn(`${accountName}: daily limit reached (${todayCount})`);
      return;
    }

    const browserManager = new BrowserManager(this.config);
    await browserManager.launch();
    const page = await browserManager.newPage();

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
        if (!this.isRunning) break;
        if (interactionsThisRun >= interactions.maxPerAccountPerRun) break;

        const tweetUrls = await this.searchTweets(page, keyword);
        logger.info(`[${accountName}] Found ${tweetUrls.length} tweets for "${keyword}"`);

        for (const tweetUrl of tweetUrls.slice(0, tweetsPerKeyword)) {
          if (!this.isRunning) break;
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

          const tweetContent = await this.getTweetContent(page, tweetUrl);
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
            count += await this.executeCombo(page, tweetActions, meta, tweetContent);
          }

          if (includeFollow) {
            if (tweetActions.length > 0) {
              await this.randomDelay(COMBO_DELAY.min, COMBO_DELAY.max);
            }
            const followed = await this.followUser(page, tweetContent.author, meta);
            if (followed) count += 1;
          }

          interactionsThisRun += count;

          await this.randomDelay(
            this.accountDelays.betweenActions.min,
            this.accountDelays.betweenActions.max
          );
        }

        await this.randomDelay(
          this.accountDelays.betweenSearchRounds?.min ||
            this.config.delays.betweenSearchRounds.min,
          this.accountDelays.betweenSearchRounds?.max ||
            this.config.delays.betweenSearchRounds.max
        );
      }

      if (this.isRunning) {
        await this.checkAndUnfollow(page, accountName, this.accountDelays);
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
        await this.processAccount(profile);
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
