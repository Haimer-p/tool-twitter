const EngagementBot = require('./engage');
const logger = require('./logger');
const { parseTweetId } = require('./utils');
const { classifyWalletRequest, buildRuleComments } = require('./walletMatcher');

class AirdropBot extends EngagementBot {
  constructor(browserManager, authManager, aiService, database, config, options = {}, onActivity) {
    super(browserManager, authManager, aiService, database, config, onActivity);
    this.useAi = options.useAi ?? false;
    this.commentMode = this.useAi ? 'ai' : 'rule';
    this.engageOnReply =
      options.engageOnReply ?? config.airdrop?.engageOnReply ?? true;
    this.followOnReply =
      options.followOnReply ?? config.airdrop?.followOnReply ?? true;
    this.minFollowersToFollow =
      options.minFollowersToFollow ?? config.airdrop?.minFollowersToFollow ?? 1000;
  }

  async engageTweetBeforeReply(page, tweetUrl, meta) {
    if (!this.engageOnReply) return 0;
    logger.info(`Engage trước comment (like/RT): ${tweetUrl.substring(0, 60)}...`);
    return this.engageBeforeComment(page, tweetUrl, {
      ...meta,
      botMode: 'airdrop',
      engageOnReply: true,
    });
  }

  getReplyPlan(walletType) {
    // both = luôn 2 comment riêng (EVM rồi Solana), Rule lẫn AI đều vậy
    if (walletType === 'both') {
      return [
        { walletType: 'evm', useAi: this.useAi },
        { walletType: 'solana', useAi: this.useAi },
      ];
    }
    return [{ walletType, useAi: this.useAi }];
  }

  getDelayBetweenComments() {
    const d = this.config.airdrop?.betweenComments;
    if (d?.min && d?.max) return d;
    return this.config.delays.betweenActions;
  }

  normalizeReplyForPost(text, walletType) {
    const wallets = this.config.wallets;
    if (walletType === 'evm' && wallets.evm) return wallets.evm;
    if (walletType === 'solana' && wallets.solana) return wallets.solana;
    return String(text || '').trim().slice(0, 100);
  }

  async buildReplyText(walletType, tweetContent) {
    const wallets = this.config.wallets;
    let text = '';

    if (this.useAi) {
      text = await this.ai.generateAirdropReply(
        tweetContent.text,
        tweetContent.author,
        walletType,
        wallets
      );
    } else {
      const comments = buildRuleComments(walletType, this.config);
      text = comments[0] || '';
    }

    const normalized = this.normalizeReplyForPost(text, walletType);
    if (this.useAi && normalized !== text.trim()) {
      logger.info(`Airdrop reply → chỉ gửi địa chỉ ${walletType} (ổn định nút Reply)`);
    }
    return normalized;
  }

  async prepareAirdropReplies(tweetContent, plan, tweetId) {
    const prepared = [];
    for (const planItem of plan) {
      const { walletType } = planItem;
      if (await this.db.hasInteractedWithTweet(tweetId, this.currentAccount, walletType)) {
        logger.info(`Skip ${walletType} reply — already commented: ${tweetId}`);
        continue;
      }
      const replyText = await this.buildReplyText(walletType, tweetContent);
      if (replyText) prepared.push({ planItem, replyText });
    }
    return prepared;
  }

  async postAirdropReply(page, tweetUrl, meta, planItem, replyText, options = {}) {
    const { walletType } = planItem;

    const replyMeta = {
      ...meta,
      walletType,
      botMode: 'airdrop',
      commentMode: this.commentMode,
      reuseTweetPage: !!options.reuseTweetPage,
    };

    return this.replyToTweet(page, tweetUrl, replyText, replyMeta);
  }

  async processAccount(accountName, keywords) {
    if (!this.isRunning) return;

    logger.info(`Airdrop mode (${this.commentMode}) — account: ${accountName}`);
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
        details: { botMode: 'airdrop', commentMode: this.commentMode },
      });

      await this.randomDelay(3000, 5000);

      let interactionsThisRun = 0;
      const keywordsPerRun = this.config.interactions.keywordsPerRun || 6;
      const tweetsPerKeyword = this.config.interactions.tweetsPerKeyword || 8;
      const searchKeywords =
        keywords.length > 0 ? keywords : this.config.airdrop.searchKeywords;
      const shuffledKeywords = [...searchKeywords].sort(() => Math.random() - 0.5);
      const selectedKeywords = shuffledKeywords.slice(0, keywordsPerRun);
      logger.info(`Airdrop keywords: ${selectedKeywords.join(', ')}`);

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

          const tweetContent = await this.getTweetContent(page, tweetUrl);
          if (!tweetContent) continue;

          const walletType = classifyWalletRequest(tweetContent.text, this.config.airdrop);
          if (walletType === 'none') {
            logger.info(`Skip — no wallet request detected: ${tweetUrl.substring(0, 60)}...`);
            continue;
          }

          logger.info(`Wallet type "${walletType}" → ${tweetUrl.substring(0, 70)}...`);

          const meta = {
            tweetId,
            tweetUrl,
            author: tweetContent.author,
            content: tweetContent.text,
            keyword,
          };

          const plan = this.getReplyPlan(walletType);
          const prepared = await this.prepareAirdropReplies(tweetContent, plan, tweetId);
          if (prepared.length === 0) continue;
          logger.info(
            `Đã chuẩn bị ${prepared.length} comment (${prepared.map((p) => p.planItem.walletType).join(' → ')})`
          );

          if (this.engageOnReply) {
            const engageCount = await this.engageTweetBeforeReply(page, tweetUrl, meta);
            interactionsThisRun += engageCount;
            if (engageCount > 0) {
              await this.randomDelay(2000, 5000);
            }
          }

          for (let i = 0; i < prepared.length; i++) {
            if (!this.isRunning) break;
            if (interactionsThisRun >= this.config.interactions.maxPerAccountPerRun) break;

            const todayNow = await this.db.getTodayInteractionCount(accountName);
            if (todayNow >= this.config.interactions.maxPerDay) break;

            if (i > 0) {
              const commentDelay = this.getDelayBetweenComments();
              logger.info(
                `Chờ ${Math.round(commentDelay.min / 1000)}-${Math.round(commentDelay.max / 1000)}s giữa 2 lần nhập ví (trước khi nhập tiếp)...`
              );
              await this.randomDelay(commentDelay.min, commentDelay.max);
            }

            const success = await this.postAirdropReply(
              page,
              tweetUrl,
              meta,
              prepared[i].planItem,
              prepared[i].replyText,
              { reuseTweetPage: i > 0 }
            );

            if (success) interactionsThisRun++;
          }

          if (this.followOnReply) {
            const followed = await this.followAuthorAfterEngage(page, {
              ...meta,
              botMode: 'airdrop',
              followOnReply: true,
              minFollowersToFollow: this.minFollowersToFollow,
            });
            if (followed) interactionsThisRun++;
          }

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

      logger.info(`Done ${accountName}: ${interactionsThisRun} airdrop replies this run`);
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
}

module.exports = AirdropBot;
