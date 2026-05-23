const logger = require('./logger');
const { sleep, randomMs, parseTweetId } = require('./utils');

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
      await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 3000);

      const unlike = await page.$(SELECTORS.unlike);
      if (unlike) return false;

      const likeButton = await page.$(SELECTORS.like);
      if (!likeButton) return false;

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
      await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(
        this.config.delays.pageLoad?.min || 3000,
        this.config.delays.pageLoad?.max || 6000
      );

      const alreadyRetweeted = await page.$('[data-testid="unretweet"]');
      if (alreadyRetweeted) {
        logger.info(`Already retweeted: ${tweetUrl}`);
        return false;
      }

      const retweetButton = await page.$(SELECTORS.retweet);
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
      });
    } catch (error) {
      logger.error(`Retweet error: ${error.message}`);
      return false;
    }
  }

  async replyToTweet(page, tweetUrl, replyText, meta) {
    try {
      await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(
        this.config.delays.pageLoad?.min || 3000,
        this.config.delays.pageLoad?.max || 6000
      );
      logger.info(`AI reply: "${replyText.substring(0, 80)}..."`);

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
      });
    } catch (error) {
      logger.error(`Reply error: ${error.message}`);
      return false;
    }
  }

  async followUser(page, username, meta) {
    try {
      if (await this.db.hasFollowedUser(username, this.currentAccount)) {
        return false;
      }

      await page.goto(`${this.baseUrl}/${username}`, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 3000);

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
