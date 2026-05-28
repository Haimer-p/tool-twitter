const logger = require('./logger');
const { sleep, randomMs, parseTweetId, parseSocialCount } = require('./utils');

const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  tweetText: 'article div[data-testid="tweetText"]',
  userName: 'article div[data-testid="User-Name"] a',
  like: 'button[data-testid="like"]',
  unlike: 'button[data-testid="unlike"]',
  retweet: 'button[data-testid="retweet"]',
  retweetConfirm: 'button[data-testid="retweetConfirm"]',
  reply: 'button[data-testid="reply"]',
  mainTweetReply: 'article[data-testid="tweet"] button[data-testid="reply"]',
  mainTweetLike: 'article[data-testid="tweet"] button[data-testid="like"]',
  mainTweetUnlike: 'article[data-testid="tweet"] button[data-testid="unlike"]',
  mainTweetRetweet: 'article[data-testid="tweet"] button[data-testid="retweet"]',
  replyBox: 'div[data-testid="tweetTextarea_0"]',
  replyEditable: 'div[data-testid="tweetTextarea_0"] div[contenteditable="true"]',
  replyComposerSelectors: [
    'div[data-testid="tweetTextarea_0"] div[contenteditable="true"]',
    'div[data-testid="tweetTextarea_0"] [role="textbox"]',
    'div[role="dialog"] div[data-testid="tweetTextarea_0"] div[contenteditable="true"]',
    'div[role="dialog"] [contenteditable="true"][role="textbox"]',
    'div[data-testid="tweetTextarea_1"] div[contenteditable="true"]',
    '[data-testid="tweetTextarea_0"] [contenteditable="true"]',
    'div.public-DraftEditor-content[contenteditable="true"]',
  ],
  tweetButton: 'button[data-testid="tweetButton"]',
  tweetButtonInline: 'button[data-testid="tweetButtonInline"]',
  follow: '[data-testid$="-follow"]:not([data-testid*="unfollow"])',
  unfollow: 'button[data-testid$="-unfollow"]',
  unfollowConfirm: 'button[data-testid="confirmationSheetConfirm"]',
};

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
    this.onActivity = onActivity || (() => {});
  }

  async randomDelay(min, max) {
    await sleep(randomMs(min, max));
  }

  async humanType(page, selector, text) {
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, {
      delay: randomMs(this.config.delays.typing.min, this.config.delays.typing.max),
    });
  }

  /** Tự bấm OK / Accept / Try again trên hộp thoại lỗi Twitter */
  async dismissTwitterDialogs(page) {
    try {
      const clicked = await page.evaluate(() => {
        let count = 0;
        const tryClick = (el) => {
          if (!el || el.disabled) return;
          el.click();
          count++;
        };

        tryClick(document.querySelector('[data-testid="confirmationSheetConfirm"]'));

        const acceptLabels = [
          'ok',
          'got it',
          'accept',
          'dismiss',
          'try again',
          'retry',
          'understood',
          'đồng ý',
          'xong',
          'tiếp tục',
          'continue',
        ];
        document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
          if (dialog.querySelector('[data-testid="tweetTextarea_0"]')) return;
          dialog.querySelectorAll('button').forEach((btn) => {
            const t = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (acceptLabels.some((l) => t === l || t.startsWith(`${l} `))) tryClick(btn);
          });
        });

        document.querySelectorAll('[data-testid="app-bar-close"]').forEach((btn) => {
          if (btn.closest('[role="dialog"]')) tryClick(btn);
        });

        return count;
      });
      if (clicked > 0) {
        logger.info(`Đã xác nhận/đóng ${clicked} hộp thoại Twitter`);
        await sleep(400);
      }
    } catch {
      /* ignore */
    }
  }

  /** Gõ từng ký tự, delay ngẫu nhiên giữa các lần nhập (không delay sau khi gõ xong) */
  async typeWithInputDelays(page, text, delayConfig) {
    const { min, max } = delayConfig;
    for (let i = 0; i < text.length; i++) {
      await page.keyboard.type(text[i], { delay: 0 });
      if (i < text.length - 1) {
        await sleep(randomMs(min, max));
      }
    }
  }

  async waitForReplyComposer(page, timeout = 15000) {
    const selectors = SELECTORS.replyComposerSelectors;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const found = await page.evaluate((sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return sel;
        }
        return null;
      }, selectors);

      if (found) return found;
      await sleep(300);
    }

    throw new Error('Không tìm thấy ô nhập reply (composer chưa mở)');
  }

  async openReplyComposer(page, tweetUrl, { quick = false } = {}) {
    const onTweet = this.isOnTweetPage(page, tweetUrl);
    await this.ensureTweetPage(page, tweetUrl);
    if (!onTweet || !quick) {
      await this.randomDelay(1500, 3000);
    } else {
      await sleep(400);
    }

    let replyButton =
      (await page.$(SELECTORS.mainTweetReply)) || (await page.$(SELECTORS.reply));
    if (!replyButton) {
      throw new Error('Không tìm thấy nút Reply trên tweet');
    }

    await replyButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await replyButton.click();
    await sleep(600);

    try {
      return await this.waitForReplyComposer(page, 12000);
    } catch {
      await replyButton.click();
      await sleep(800);
      return await this.waitForReplyComposer(page, 12000);
    }
  }

  async fillReplyText(page, text, editableSel, meta = {}) {
    await page.click(editableSel);

    const filled = await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.innerHTML = '';
      const ok = document.execCommand('insertText', false, val);
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return ok || (el.innerText || el.textContent || '').includes(val.slice(0, 8));
    }, editableSel, text);

    if (!filled) {
      await page.click(editableSel);
      await page.keyboard.type(text, { delay: meta.botMode === 'airdrop' ? 0 : 30 });
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }, editableSel);
    }

    await sleep(400);
  }

  isRetryableReplyError(error) {
    const msg = error?.message || '';
    return (
      msg.includes('ERR_ABORTED') ||
      msg.includes('net::ERR') ||
      msg.includes('Navigation') ||
      msg.includes('timeout') ||
      msg.includes('Execution context was destroyed')
    );
  }

  normalizeTweetUrl(url) {
    return String(url || '')
      .replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com/i, 'https://x.com')
      .split('?')[0]
      .replace(/\/$/, '');
  }

  isOnTweetPage(page, tweetUrl) {
    const target = this.normalizeTweetUrl(tweetUrl);
    const current = this.normalizeTweetUrl(page.url());
    return current === target;
  }

  async gotoTweetPage(page, tweetUrl) {
    const timeout = this.config.browser?.navigationTimeout || 30000;
    try {
      await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout });
    } catch (error) {
      try {
        await page.evaluate(() => window.stop());
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  async ensureTweetPage(page, tweetUrl, { forceReload = false } = {}) {
    if (!forceReload && this.isOnTweetPage(page, tweetUrl)) {
      logger.info('Đã ở trang tweet — bỏ qua goto, reply tiếp');
      try {
        await page.evaluate(() => window.stop());
      } catch {
        /* ignore */
      }
      await this.dismissTwitterDialogs(page);
      return;
    }
    await this.gotoTweetPage(page, tweetUrl);
  }

  decideAction() {
    const { likeRatio, retweetRatio, replyRatio, followRatio } = this.config.interactions;
    const rand = Math.random();
    if (rand < likeRatio) return 'like';
    if (rand < likeRatio + retweetRatio) return 'retweet';
    if (rand < likeRatio + retweetRatio + replyRatio) return 'reply';
    if (rand < likeRatio + retweetRatio + replyRatio + followRatio) return 'follow';
    return 'like';
  }

  async searchTweets(page, keyword) {
    logger.info(`Searching tweets: ${keyword}`);
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await this.randomDelay(
      this.config.delays.scroll.min,
      this.config.delays.scroll.max
    );

    const tweets = await page.$$eval(SELECTORS.tweet, (articles) =>
      articles
        .map((article) => {
          const link = article.querySelector('a[href*="/status/"]');
          return link ? link.href : null;
        })
        .filter(Boolean)
    ).catch(() => []);

    return [...new Set(tweets)];
  }

  async getTweetContent(page, tweetUrl) {
    try {
      await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 3000);

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

  async likeTweet(page, tweetUrl, meta) {
    try {
      await this.gotoTweetPage(page, tweetUrl);
      const isAirdrop = meta.botMode === 'airdrop';
      await this.randomDelay(isAirdrop ? 1000 : 2000, isAirdrop ? 2000 : 3000);
      await this.dismissTwitterDialogs(page);

      const unlike =
        (await page.$(SELECTORS.mainTweetUnlike)) || (await page.$(SELECTORS.unlike));
      if (unlike) return false;

      const likeButton =
        (await page.$(SELECTORS.mainTweetLike)) || (await page.$(SELECTORS.like));
      if (!likeButton) return false;

      await likeButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await likeButton.click();
      logger.info(`Liked: ${tweetUrl}`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'like',
        accountName: this.currentAccount,
        keywordUsed: meta.keyword,
        walletType: meta.walletType || 'like',
        botMode: meta.botMode || 'engage',
      });
    } catch (error) {
      logger.error(`Like error: ${error.message}`);
      await this.db.logActivity({
        accountName: this.currentAccount,
        action: 'error',
        target: tweetUrl,
        success: false,
        errorMessage: error.message,
      });
      return false;
    }
  }

  async retweet(page, tweetUrl, meta) {
    try {
      await this.gotoTweetPage(page, tweetUrl);
      const isAirdrop = meta.botMode === 'airdrop';
      await this.randomDelay(
        isAirdrop ? 1000 : this.config.delays.pageLoad?.min || 3000,
        isAirdrop ? 2000 : this.config.delays.pageLoad?.max || 6000
      );
      await this.dismissTwitterDialogs(page);

      const alreadyRetweeted =
        (await page.$('article[data-testid="tweet"] [data-testid="unretweet"]')) ||
        (await page.$('[data-testid="unretweet"]'));
      if (alreadyRetweeted) {
        logger.info(`Already retweeted: ${tweetUrl}`);
        return false;
      }

      const retweetButton =
        (await page.$(SELECTORS.mainTweetRetweet)) || (await page.$(SELECTORS.retweet));
      if (!retweetButton) {
        logger.warn(`Retweet button not found: ${tweetUrl}`);
        return false;
      }

      await retweetButton.click();
      await this.randomDelay(1000, 2000);

      const confirmButton =
        (await page.$(SELECTORS.retweetConfirm)) ||
        (await page.$('[data-testid="retweetConfirm"]'));
      if (!confirmButton) {
        logger.warn(`Retweet confirm not found: ${tweetUrl}`);
        return false;
      }

      await confirmButton.click();
      await this.randomDelay(1500, 2500);
      logger.info(`Retweeted: ${tweetUrl}`);

      return await this.recordInteraction({
        tweetId: meta.tweetId,
        tweetUrl,
        authorUsername: meta.author,
        content: meta.content,
        interactionType: 'retweet',
        accountName: this.currentAccount,
        keywordUsed: meta.keyword,
        walletType: meta.walletType || 'retweet',
        botMode: meta.botMode || 'engage',
      });
    } catch (error) {
      logger.error(`Retweet error: ${error.message}`);
      return false;
    }
  }

  async engageBeforeComment(page, tweetUrl, meta) {
    const engageMeta = { ...meta, botMode: meta.botMode || 'airdrop' };
    const doLikeRt = meta.engageOnReply !== false;
    let count = 0;

    if (
      doLikeRt &&
      !(await this.db.hasInteractedWithTweet(meta.tweetId, this.currentAccount, 'like'))
    ) {
      const liked = await this.likeTweet(page, tweetUrl, {
        ...engageMeta,
        walletType: 'like',
      });
      if (liked) count++;
      await this.randomDelay(2000, 4000);
    }

    if (
      doLikeRt &&
      !(await this.db.hasInteractedWithTweet(meta.tweetId, this.currentAccount, 'retweet'))
    ) {
      const retweeted = await this.retweet(page, tweetUrl, {
        ...engageMeta,
        walletType: 'retweet',
      });
      if (retweeted) count++;
      await this.randomDelay(2000, 4000);
    }

    return count;
  }

  async followAuthorAfterEngage(page, meta) {
    if (meta.followOnReply === false || !meta.author) return false;
    if (await this.db.hasFollowedUser(meta.author, this.currentAccount)) return false;

    const followed = await this.followUser(page, meta.author, {
      ...meta,
      botMode: meta.botMode || 'airdrop',
      walletType: 'follow',
      minFollowersToFollow: meta.minFollowersToFollow,
    });
    return followed;
  }

  /** Inline reply dùng tweetButtonInline; modal dùng tweetButton */
  async submitReply(page) {
    const deadline = Date.now() + 15000;
    const buttonSelectors = [
      'button[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButton"]',
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
    ];

    while (Date.now() < deadline) {
      const clicked = await page.evaluate((sels) => {
        const enabled = (btn) =>
          btn &&
          !btn.disabled &&
          btn.getAttribute('aria-disabled') !== 'true' &&
          window.getComputedStyle(btn).pointerEvents !== 'none';

        for (const sel of sels) {
          const nodes = document.querySelectorAll(sel);
          for (const btn of nodes) {
            if (enabled(btn)) {
              btn.click();
              return sel;
            }
          }
        }
        return null;
      }, buttonSelectors);

      if (clicked) {
        logger.info(`Đã bấm nút gửi: ${clicked}`);
        return true;
      }

      await page.keyboard.down('Control');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Control');

      const maybeSent = await page.evaluate(() => {
        const el = document.querySelector('div[data-testid="tweetTextarea_0"] div[contenteditable="true"]');
        return !el || !(el.innerText || el.textContent || '').trim();
      });
      if (maybeSent) {
        logger.info('Đã gửi reply bằng Ctrl+Enter');
        return true;
      }

      await sleep(200);
    }

    return false;
  }

  async waitForReplySent(page) {
    try {
      await page.waitForFunction(
        () => {
          const box = document.querySelector('div[data-testid="tweetTextarea_0"]');
          if (!box) return true;
          const t = (box.innerText || box.textContent || '').trim();
          return t.length === 0;
        },
        { timeout: 12000 }
      );
    } catch {
      await sleep(800);
    }
  }

  /** @deprecated use engageBeforeComment */
  async likeAndRetweetTweet(page, tweetUrl, meta) {
    return this.engageBeforeComment(page, tweetUrl, meta);
  }

  async replyToTweet(page, tweetUrl, replyText, meta) {
    const maxAttempts = 2;
    const reusePage = !!meta.reuseTweetPage;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          await this.ensureTweetPage(page, tweetUrl, { forceReload: true });
          await sleep(1000);
        }

        await this.dismissTwitterDialogs(page);
        logger.info(`Reply: "${replyText.substring(0, 80)}..."`);

        const editableSel = await this.openReplyComposer(page, tweetUrl, {
          quick: reusePage && attempt === 1,
        });
        await this.fillReplyText(page, replyText, editableSel, meta);

        const posted = await this.submitReply(page);
        if (!posted) {
          throw new Error('Nút Reply chưa sáng / không bấm được');
        }

        await this.waitForReplySent(page);
        if (meta.botMode !== 'airdrop') {
          await this.randomDelay(1500, 2500);
        } else {
          await sleep(300);
        }
        await this.dismissTwitterDialogs(page);
        logger.info(`Replied: ${tweetUrl.substring(0, 60)}...`);

        return await this.recordInteraction({
          tweetId: meta.tweetId,
          tweetUrl,
          authorUsername: meta.author,
          content: meta.content,
          interactionType: 'reply',
          accountName: this.currentAccount,
          keywordUsed: meta.keyword,
          aiGeneratedReply: replyText,
          walletType: meta.walletType || 'engage',
          botMode: meta.botMode || 'engage',
          commentMode: meta.commentMode,
        });
      } catch (error) {
        await this.dismissTwitterDialogs(page);
        if (attempt < maxAttempts && this.isRetryableReplyError(error)) {
          logger.warn(`Reply thử lại (${attempt + 1}/${maxAttempts}): ${error.message}`);
          await sleep(2000);
          continue;
        }
        logger.error(`Reply error: ${error.message}`);
        return false;
      }
    }

    return false;
  }

  resolveMinFollowers(meta) {
    const fromMeta = meta?.minFollowersToFollow;
    if (fromMeta !== undefined && fromMeta !== null) return Number(fromMeta);
    return (
      this.config.airdrop?.minFollowersToFollow ??
      this.config.follow?.minFollowers ??
      0
    );
  }

  async getUserFollowerCount(page, username) {
    try {
      const raw = await page.evaluate(() => {
        const link =
          document.querySelector(`a[href="/${location.pathname.split('/')[1]}/followers"]`) ||
          document.querySelector('a[href$="/followers"]');
        if (link) return link.innerText || link.textContent || '';

        const header = document.querySelector('[data-testid="UserProfileHeader_Items"]');
        return header ? header.innerText || header.textContent || '' : '';
      });

      const followerMatch = raw.match(/([\d.,]+\s*[KkMmBb]?)\s*(followers?|người\s*theo\s*dõi)/i);
      if (followerMatch) {
        const n = parseSocialCount(followerMatch[1]);
        if (n !== null) return n;
      }

      const parts = raw.split(/\s+/).filter(Boolean);
      for (const part of parts) {
        const n = parseSocialCount(part);
        if (n !== null && n > 0) return n;
      }

      logger.warn(`@${username}: không đọc được số followers từ profile`);
      return null;
    } catch (error) {
      logger.warn(`@${username}: lỗi đọc followers — ${error.message}`);
      return null;
    }
  }

  async followUser(page, username, meta) {
    try {
      if (await this.db.hasFollowedUser(username, this.currentAccount)) {
        return false;
      }

      await page.goto(`${this.baseUrl}/${username}`, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 3000);
      await this.dismissTwitterDialogs(page);

      const minFollowers = this.resolveMinFollowers(meta);
      if (minFollowers > 0) {
        const followers = await this.getUserFollowerCount(page, username);
        if (followers === null) {
          logger.info(`Skip follow @${username}: không đọc được số followers`);
          return false;
        }
        if (followers < minFollowers) {
          logger.info(
            `Skip follow @${username}: ${followers.toLocaleString()} followers < ${minFollowers.toLocaleString()}`
          );
          return false;
        }
        logger.info(
          `@${username}: ${followers.toLocaleString()} followers (>= ${minFollowers.toLocaleString()})`
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
      logger.info(`Followed @${username}`);

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
        walletType: meta.walletType || 'follow',
        botMode: meta.botMode || 'engage',
      });
    } catch (error) {
      logger.error(`Follow error: ${error.message}`);
      await this.db.logActivity({
        accountName: this.currentAccount,
        action: 'follow',
        target: `@${username}`,
        success: false,
        errorMessage: error.message,
      });
      return false;
    }
  }

  async checkAndUnfollow(page, accountName) {
    const users = await this.db.getUsersToCheckFollowBack(
      accountName,
      this.config.interactions.followBackWaitDays
    );

    for (const user of users) {
      if (!this.isRunning) break;

      logger.info(`Checking follow-back: @${user.username}`);
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
        logger.info(`@${user.username} followed back`);
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
          logger.info(`Unfollowed @${user.username}`);
        }
      }

      await this.randomDelay(
        this.config.delays.betweenActions.min,
        this.config.delays.betweenActions.max
      );
    }
  }

  async processAccount(accountName, keywords) {
    if (!this.isRunning) return;

    logger.info(`Processing account: ${accountName}`);
    this.currentAccount = accountName;

    const todayCount = await this.db.getTodayInteractionCount(accountName);
    if (todayCount >= this.config.interactions.maxPerDay) {
      logger.warn(`${accountName}: daily limit reached (${todayCount})`);
      return;
    }

    await this.browser.launch();
    const page = await this.browser.newPage();

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
      const keywordsPerRun =
        this.config.interactions.keywordsPerRun || 6;
      const tweetsPerKeyword =
        this.config.interactions.tweetsPerKeyword || 8;
      const shuffledKeywords = [...keywords].sort(() => Math.random() - 0.5);
      const selectedKeywords = shuffledKeywords.slice(0, keywordsPerRun);
      logger.info(`Keywords this run: ${selectedKeywords.join(', ')}`);

      for (const keyword of selectedKeywords) {
        if (!this.isRunning) break;
        if (interactionsThisRun >= this.config.interactions.maxPerAccountPerRun) break;

        const tweetUrls = await this.searchTweets(page, keyword);
        logger.info(`Found ${tweetUrls.length} tweets for "${keyword}"`);

        for (const tweetUrl of tweetUrls.slice(0, tweetsPerKeyword)) {
          if (!this.isRunning) break;
          if (interactionsThisRun >= this.config.interactions.maxPerAccountPerRun) break;

          const today = await this.db.getTodayInteractionCount(accountName);
          if (today >= this.config.interactions.maxPerDay) break;

          const tweetId = parseTweetId(tweetUrl);
          if (!tweetId) continue;

          if (await this.db.hasInteractedWithTweet(tweetId, accountName)) {
            continue;
          }

          const tweetContent = await this.getTweetContent(page, tweetUrl);
          if (!tweetContent) continue;

          const meta = {
            tweetId,
            tweetUrl,
            author: tweetContent.author,
            content: tweetContent.text,
            keyword,
          };

          const action = this.decideAction();
          logger.info(`Action "${action}" → ${tweetUrl.substring(0, 70)}...`);
          let success = false;

          switch (action) {
            case 'like':
              success = await this.likeTweet(page, tweetUrl, meta);
              break;
            case 'retweet':
              success = await this.retweet(page, tweetUrl, meta);
              break;
            case 'reply': {
              const replyText = await this.ai.generateReply(
                tweetContent.text,
                tweetContent.author
              );
              success = await this.replyToTweet(page, tweetUrl, replyText, meta);
              break;
            }
            case 'follow':
              success = await this.followUser(page, tweetContent.author, meta);
              break;
            default:
              break;
          }

          if (success) interactionsThisRun++;

          await this.randomDelay(
            this.config.delays.betweenActions.min,
            this.config.delays.betweenActions.max
          );
        }

        await this.randomDelay(
          this.config.delays.betweenSearchRounds.min,
          this.config.delays.betweenSearchRounds.max
        );
      }

      if (this.isRunning) {
        await this.checkAndUnfollow(page, accountName);
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
      await this.browser.close();
    }
  }

  async runMultipleAccounts(accounts, keywords) {
    for (const account of accounts) {
      if (!this.isRunning) break;
      await this.processAccount(account, keywords);
      await this.randomDelay(
        this.config.delays.betweenAccounts.min,
        this.config.delays.betweenAccounts.max
      );
    }
  }
}

module.exports = EngagementBot;
