Dưới đây là hướng dẫn chi tiết để xây dựng tool tự động tương tác Twitter (X) với Node.js, đáp ứng các yêu cầu của bạn.

## **Kiến trúc tổng thể**

Tool sẽ sử dụng **Puppeteer/Playwright** để điều khiển trình duyệt, kết hợp với **Gemini AI** để sinh nội dung reply thông minh.

## **Thư viện và công cụ cần thiết**

Dựa trên các kết quả tìm kiếm, đây là những thư viện phù hợp nhất:


| **Thư viên**                         | **Mục đích**          | **Lý do chọn**                       |
| ------------------------------------ | --------------------- | ------------------------------------ |
| `puppeteer-extra` + `stealth-plugin` | Browser automation    | Vượt qua bot detection của Twitter/X |
| `@google/generative-ai`              | Gemini AI integration | Miễn phí, sinh reply tự nhiên        |
| `node-cron` / `node-schedule`        | Scheduling            | Thiết lập thời gian chạy             |
| `winston`                            | Logging               | Ghi nhật ký hoạt động                |
| `dotenv`                             | Config management     | Quản lý biến môi trường              |


## **Code hoàn chỉnh**

### **1. Cấu trúc thư mục**

text

```
twitter-auto-engage/
├── src/
│   ├── browser.js      # Khởi tạo browser với anti-detection
│   ├── auth.js         # Quản lý đăng nhập và cookies
│   ├── ai.js           # Gemini AI integration
│   ├── engage.js       # Logic tương tác chính
│   ├── scheduler.js    # Lên lịch và quản lý delay
│   └── index.js        # Entry point
├── accounts/           # Lưu cookies từng tài khoản
├── .env
├── package.json
└── config.js
```

### **2. Cài đặt dependencies**

bash

```
mkdir twitter-auto-engage && cd twitter-auto-engage
npm init -y

npm install puppeteer-extra puppeteer-extra-plugin-stealth @google/generative-ai node-cron winston dotenv
npm install --save-dev typescript @types/node
```

### **3. File cấu hình** `config.js`

javascript

```
// config.js
module.exports = {
  // Delay settings (milliseconds) - tránh bị khóa
  delays: {
    betweenActions: { min: 30000, max: 90000 },    // 30-90 giây giữa các actions
    betweenAccounts: { min: 120000, max: 300000 },  // 2-5 phút giữa các tài khoản
    betweenSearchRounds: { min: 300000, max: 600000 }, // 5-10 phút giữa các đợt tìm kiếm
    typing: { min: 50, max: 150 },                   // 50-150ms mỗi ký tự khi gõ [citation:6]
    scroll: { min: 500, max: 1500 },                 // Delay khi scroll
  },
  
  // Interaction settings
  interactions: {
    maxPerDay: 50,           // Tối đa 50 tương tác/ngày
    maxPerAccountPerRun: 15, // Tối đa 15 tweet mỗi lần chạy
    likeRatio: 0.7,          // 70% tweet sẽ like
    retweetRatio: 0.2,       // 20% tweet sẽ retweet
    replyRatio: 0.3,         // 30% tweet sẽ reply
  },
  
  // Browser settings
  browser: {
    headless: false,  // false để dễ debug và tránh detection
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 },
  },
  
  // Gemini settings
  gemini: {
    model: 'gemini-1.5-flash', // Free tier
    temperature: 0.9,
  },
  
  // Keywords for Web3
  keywords: [
    'web3', 'crypto', 'blockchain', 'defi', 'nft',
    'ethereum', 'solana', 'bitcoin', 'smart contract',
    'dapp', 'dao', 'layer2', 'zero knowledge'
  ],
};
```

### **4. Browser và Anti-detection** `src/browser.js`

javascript

```
// src/browser.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
  }

  async launch() {
    this.browser = await puppeteer.launch({
      headless: this.config.browser.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        `--window-size=${this.config.browser.viewport.width},${this.config.browser.viewport.height}`,
        // Tránh bị phát hiện automation [citation:6]
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = await this.browser.newPage();
    await page.setViewport(this.config.browser.viewport);
    await page.setUserAgent(this.config.browser.userAgent);

    // Xóa các dấu hiệu automation
    await page.evaluateOnNewDocument(() => {
      delete navigator.__webdriver;
      delete navigator.__selenium;
      delete navigator.__ puppeteer;
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    return this.browser;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = BrowserManager;
```

### **5. Quản lý Authentication** `src/auth.js`

javascript

```
// src/auth.js
const fs = require('fs').promises;
const path = require('path');

class AuthManager {
  constructor(accountsDir = './accounts') {
    this.accountsDir = accountsDir;
  }

  async ensureAccountsDir() {
    try {
      await fs.access(this.accountsDir);
    } catch {
      await fs.mkdir(this.accountsDir, { recursive: true });
    }
  }

  getCookiePath(accountName) {
    return path.join(this.accountsDir, `${accountName}.json`);
  }

  async saveCookies(accountName, cookies) {
    await this.ensureAccountsDir();
    await fs.writeFile(this.getCookiePath(accountName), JSON.stringify(cookies, null, 2));
  }

  async loadCookies(accountName) {
    try {
      const data = await fs.readFile(this.getCookiePath(accountName), 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async login(page, accountName, credentials = null) {
    const cookies = await this.loadCookies(accountName);
    
    if (cookies) {
      // Dùng cookies đã lưu
      await page.setCookie(...cookies);
      await page.goto('https://twitter.com/home');
      
      // Kiểm tra đăng nhập thành công
      await page.waitForTimeout(3000);
      const currentUrl = page.url();
      if (currentUrl.includes('/home')) {
        console.log(`✅ ${accountName}: Đăng nhập bằng cookies thành công`);
        return true;
      }
    }
    
    // Nếu không có cookies hoặc cookies hết hạn, yêu cầu đăng nhập thủ công
    console.log(`🔐 ${accountName}: Vui lòng đăng nhập thủ công vào Twitter/X...`);
    console.log(`   Tool sẽ mở trình duyệt, bạn đăng nhập và nhấn Enter khi hoàn tất`);
    
    await page.goto('https://twitter.com/login');
    
    // Chờ người dùng đăng nhập thủ công
    await new Promise(resolve => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      readline.question('✅ Đã đăng nhập xong? (Enter để tiếp tục): ', () => {
        readline.close();
        resolve();
      });
    });
    
    // Lưu cookies sau khi đăng nhập
    const newCookies = await page.cookies();
    await this.saveCookies(accountName, newCookies);
    console.log(`💾 ${accountName}: Đã lưu cookies`);
    
    return true;
  }
}

module.exports = AuthManager;
```

### **6. Gemini AI Integration** `src/ai.js`

javascript

```
// src/ai.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
  constructor(apiKey, config) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: config.gemini.model,
      generationConfig: {
        temperature: config.gemini.temperature,
      }
    });
  }

  async generateReply(tweetText, tweetAuthor, context = '') {
    const prompt = `
    Bạn là một người dùng Twitter hoạt động trong lĩnh vực Web3/Crypto.
    Hãy tạo một reply tự nhiên, thân thiện cho tweet sau:
    
    Tweet từ @${tweetAuthor}: "${tweetText}"
    ${context ? `Ngữ cảnh bổ sung: ${context}` : ''}
    
    Yêu cầu:
    - Reply ngắn gọn, 1-2 câu
    - Thể hiện sự quan tâm đến chủ đề Web3
    - Không spam, không quảng cáo trắng trợn
    - Tự nhiên như người thật
    - Có thể thêm emoji phù hợp
    
    Chỉ trả về nội dung reply, không giải thích thêm.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const reply = result.response.text().trim();
      return reply;
    } catch (error) {
      console.error('AI generation error:', error);
      // Fallback replies nếu API lỗi
      const fallbacks = [
        `Thanks for sharing this! Really interesting perspective on ${this.extractTopic(tweetText)} 🔥`,
        `Great point! Web3 needs more discussions like this 💯`,
        `I've been following this closely. Thanks for the update! 🚀`,
        `This is why I love the Web3 space - always learning something new 🙌`,
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  extractTopic(tweetText) {
    const keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'ethereum', 'solana'];
    for (const kw of keywords) {
      if (tweetText.toLowerCase().includes(kw)) return kw;
    }
    return 'this topic';
  }
}

module.exports = AIService;
```

### **7. Logic tương tác chính** `src/engage.js`

javascript

```
// src/engage.js
class EngagementBot {
  constructor(browserManager, authManager, aiService, config) {
    this.browser = browserManager;
    this.auth = authManager;
    this.ai = aiService;
    this.config = config;
    this.dailyCount = 0;
  }

  randomDelay(min, max) {
    const delay = Math.random() * (max - min) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async humanType(page, selector, text) {
    await page.click(selector);
    for (const char of text) {
      await page.type(selector, char, { delay: this.randomDelay(50, 150) });
      await this.randomDelay(20, 50);
    }
  }

  async searchTweets(page, keyword) {
    console.log(`🔍 Tìm kiếm tweets với keyword: ${keyword}`);
    await page.goto(`https://twitter.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`);
    await this.randomDelay(2000, 4000);
    
    // Scroll để load thêm tweets
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await this.randomDelay(1500, 2500);
    
    // Lấy tất cả tweet links
    const tweets = await page.$$eval('article[data-testid="tweet"]', (articles) => {
      return articles.map(article => {
        const link = article.querySelector('a[href*="/status/"]');
        return link ? link.href : null;
      }).filter(Boolean);
    });
    
    return [...new Set(tweets)]; // Loại bỏ duplicate
  }

  async likeTweet(page, tweetUrl) {
    try {
      await page.goto(tweetUrl);
      await this.randomDelay(2000, 3000);
      
      const likeButton = await page.$('button[data-testid="like"]');
      if (likeButton) {
        const isLiked = await page.$('button[data-testid="unlike"]');
        if (!isLiked) {
          await likeButton.click();
          console.log(`❤️ Liked: ${tweetUrl}`);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error(`Like error: ${error.message}`);
      return false;
    }
  }

  async retweet(page, tweetUrl) {
    try {
      await page.goto(tweetUrl);
      await this.randomDelay(2000, 3000);
      
      const retweetButton = await page.$('button[data-testid="retweet"]');
      if (retweetButton) {
        await retweetButton.click();
        await this.randomDelay(500, 1000);
        
        // Confirm retweet
        const confirmButton = await page.$('button[data-testid="retweetConfirm"]');
        if (confirmButton) {
          await confirmButton.click();
          console.log(`🔄 Retweeted: ${tweetUrl}`);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error(`Retweet error: ${error.message}`);
      return false;
    }
  }

  async replyToTweet(page, tweetUrl, replyText) {
    try {
      await page.goto(tweetUrl);
      await this.randomDelay(2000, 4000);
      
      // Click reply button
      const replyButton = await page.$('button[data-testid="reply"]');
      if (!replyButton) return false;
      
      await replyButton.click();
      await this.randomDelay(1000, 1500);
      
      // Find reply textarea
      const replyBox = await page.$('div[data-testid="tweetTextarea_0"]');
      if (!replyBox) return false;
      
      await replyBox.click();
      await this.humanType(page, 'div[data-testid="tweetTextarea_0"]', replyText);
      await this.randomDelay(1000, 1500);
      
      // Post reply
      const postButton = await page.$('button[data-testid="tweetButton"]');
      if (postButton) {
        await postButton.click();
        console.log(`💬 Replied to: ${tweetUrl.substring(0, 60)}...`);
        console.log(`   Reply: "${replyText.substring(0, 100)}"`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Reply error: ${error.message}`);
      return false;
    }
  }

  async processAccount(accountName, keywords) {
    console.log(`\n🚀 Bắt đầu xử lý tài khoản: ${accountName}`);
    
    const browser = await this.browser.launch();
    const page = await browser.newPage();
    
    try {
      // Login
      const loggedIn = await this.auth.login(page, accountName);
      if (!loggedIn) {
        console.error(`❌ Không thể đăng nhập ${accountName}`);
        return;
      }
      
      await this.randomDelay(3000, 5000);
      
      let interactionsThisRun = 0;
      
      // Randomly select keywords for this run
      const shuffledKeywords = [...keywords].sort(() => 0.5 - Math.random());
      const selectedKeywords = shuffledKeywords.slice(0, 3);
      
      for (const keyword of selectedKeywords) {
        if (interactionsThisRun >= this.config.interactions.maxPerAccountPerRun) {
          console.log(`📊 Đã đạt giới hạn ${this.config.interactions.maxPerAccountPerRun} tương tác cho tài khoản này`);
          break;
        }
        
        // Search tweets by keyword
        const tweetUrls = await this.searchTweets(page, keyword);
        console.log(`📝 Tìm thấy ${tweetUrls.length} tweets cho keyword "${keyword}"`);
        
        for (const tweetUrl of tweetUrls.slice(0, 10)) { // Giới hạn 10 tweet mỗi keyword
          if (interactionsThisRun >= this.config.interactions.maxPerAccountPerRun) break;
          
          const action = this.decideAction();
          
          switch (action) {
            case 'like':
              const liked = await this.likeTweet(page, tweetUrl);
              if (liked) interactionsThisRun++;
              break;
              
            case 'retweet':
              const retweeted = await this.retweet(page, tweetUrl);
              if (retweeted) interactionsThisRun++;
              break;
              
            case 'reply':
              // Get tweet content for AI
              const tweetContent = await this.getTweetContent(page, tweetUrl);
              if (tweetContent) {
                const replyText = await this.ai.generateReply(tweetContent.text, tweetContent.author);
                const replied = await this.replyToTweet(page, tweetUrl, replyText);
                if (replied) interactionsThisRun++;
              }
              break;
          }
          
          // Random delay between actions
          await this.randomDelay(
            this.config.delays.betweenActions.min,
            this.config.delays.betweenActions.max
          );
        }
        
        // Delay between keywords
        await this.randomDelay(
          this.config.delays.betweenSearchRounds.min,
          this.config.delays.betweenSearchRounds.max
        );
      }
      
      console.log(`✅ Hoàn thành ${interactionsThisRun} tương tác cho ${accountName}`);
      
    } catch (error) {
      console.error(`Lỗi xử lý ${accountName}:`, error);
    } finally {
      await browser.close();
    }
  }
  
  decideAction() {
    const rand = Math.random();
    if (rand < this.config.interactions.likeRatio) return 'like';
    if (rand < this.config.interactions.likeRatio + this.config.interactions.retweetRatio) return 'retweet';
    if (rand < this.config.interactions.likeRatio + this.config.interactions.retweetRatio + this.config.interactions.replyRatio) return 'reply';
    return 'like';
  }
  
  async getTweetContent(page, tweetUrl) {
    try {
      await page.goto(tweetUrl);
      await this.randomDelay(2000, 3000);
      
      const text = await page.$eval('article div[data-testid="tweetText"]', el => el.textContent).catch(() => '');
      const author = await page.$eval('article div[data-testid="User-Name"] a', el => el.href.split('/').pop()).catch(() => 'user');
      
      return { text: text || 'No content', author };
    } catch {
      return null;
    }
  }
  
  async runMultipleAccounts(accounts, keywords) {
    for (const account of accounts) {
      await this.processAccount(account, keywords);
      
      // Delay between accounts
      await this.randomDelay(
        this.config.delays.betweenAccounts.min,
        this.config.delays.betweenAccounts.max
      );
    }
  }
}

module.exports = EngagementBot;
```

### **8. Scheduler và Entry point** `src/index.js`

javascript

```
// src/index.js
require('dotenv').config();
const cron = require('node-cron');
const readline = require('readline');

const BrowserManager = require('./browser');
const AuthManager = require('./auth');
const AIService = require('./ai');
const EngagementBot = require('./engage');
const config = require('../config');

// Helper để nhập từ bàn phím
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🤖 Twitter/X Auto Engagement Tool       ║
  ║   Web3 Focus + Gemini AI                  ║
  ╚═══════════════════════════════════════════╝
  `);
  
  // Nhập danh sách tài khoản
  const accountsInput = await askQuestion('Nhập tên các tài khoản (cách nhau bằng dấu phẩy, ví dụ: account1,account2,account3): ');
  const accounts = accountsInput.split(',').map(a => a.trim());
  
  // Nhập keywords
  const keywordsInput = await askQuestion(`Nhập keywords muốn theo dõi (mặc định: ${config.keywords.join(', ')}): `);
  const keywords = keywordsInput.trim() ? keywordsInput.split(',').map(k => k.trim()) : config.keywords;
  
  // Thiết lập thời gian chạy
  console.log('\n📅 Thiết lập lịch trình:');
  console.log('1. Chạy ngay lập tức');
  console.log('2. Chạy theo lịch (cron expression)');
  console.log('3. Chạy tuần tự không lặp lại');
  
  const scheduleChoice = await askQuestion('Lựa chọn (1-3): ');
  
  // Khởi tạo services
  const browserManager = new BrowserManager(config);
  const authManager = new AuthManager('./accounts');
  const aiService = new AIService(process.env.GEMINI_API_KEY, config);
  const bot = new EngagementBot(browserManager, authManager, aiService, config);
  
  const runBot = async () => {
    console.log(`\n🚀 Bắt đầu chạy bot lúc: ${new Date().toLocaleString()}`);
    await bot.runMultipleAccounts(accounts, keywords);
    console.log(`✅ Kết thúc chạy bot lúc: ${new Date().toLocaleString()}`);
  };
  
  switch (scheduleChoice) {
    case '1':
      await runBot();
      break;
      
    case '2':
      const cronExp = await askQuestion('Nhập cron expression (vd: "0 */6 * * *" để chạy mỗi 6 tiếng): ');
      console.log(`📅 Bot sẽ chạy theo lịch: ${cronExp}`);
      cron.schedule(cronExp, runBot);
      // Chạy lần đầu ngay lập tức
      await runBot();
      break;
      
    case '3':
      await runBot();
      console.log('Bot đã hoàn thành. Nhấn Ctrl+C để thoát.');
      break;
  }
}

// Kiểm tra API key
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Vui lòng set GEMINI_API_KEY trong file .env');
  console.log('   Lấy key tại: https://aistudio.google.com/app/apikey');
  process.exit(1);
}

main().catch(console.error);
```

### **9. File** `.env`

env

```
# .env
GEMINI_API_KEY=your_gemini_api_key_here
```

## **Cách sử dụng**

### **Bước 1: Cài đặt**

bash

```
npm install
cp .env.example .env  # Thêm API key Gemini vào đây
```

### **Bước 2: Lấy Gemini API Key (Miễn phí)**

- Truy cập [Google AI Studio](https://aistudio.google.com/app/apikey)
- Tạo API key (hoàn toàn miễn phí với giới hạn 60 requests/phút)

### **Bước 3: Chạy tool**

bash

```
node src/index.js
```

### **Bước 4: Làm theo hướng dẫn**

- Nhập tên các tài khoản (vd: `crypto_bot1,web3_trader2`)
- Nhập keywords hoặc để mặc định
- Đăng nhập thủ công lần đầu - tool sẽ tự lưu cookies

## **Lưu ý quan trọng để tránh bị khóa tài khoản**

1. **Delay hợp lý**: Code đã tích hợp delays ngẫu nhiên từ 30-90 giây giữa các actions
2. **Giới hạn tương tác**: Mặc định 50 interactions/ngày
3. **Không chạy 24/7**: Nên chạy 2-3 lần/ngày, mỗi lần 30-60 phút
4. **Sử dụng proxy** (khuyến nghị cho nhiều tài khoản):

javascript

```
// Thêm vào browser.js
args: [`--proxy-server=${proxyHost}:${proxyPort}`]
```

1. **Kiểm tra log thường xuyên** để phát hiện hành vi bất thường

## **Mở rộng**

- **Thêm tính năng follow**: Tương tự like/retweet
- **Dashboard giám sát**: Dùng Express để hiển thị thống kê
- **Database lưu trữ**: Lưu lại các tweet đã tương tác tránh trùng lặp

Tool này hoàn toàn có thể chạy 2-3 tài khoản song song hoặc tuần tự tùy theo cấu hình bạn chọn.

*Phản hồi này do AI tạo ra, chỉ mang tính tham khảo.*

Thêm tính năng follow: Tương tự like/retweet  
  
Dashboard giám sát: Dùng Express để hiển thị thống kê  
  
Database lưu trữ: Lưu lại các tweet đã tương tác tránh trùng lặp ( dùng mysql hoặc mongodb)

Dưới đây là phiên bản nâng cấp của tool với đầy đủ 3 tính năng bạn yêu cầu: **Follow**, **Dashboard giám sát (Express)** và **Database lưu trữ (MongoDB)**.

## **Cập nhật cấu trúc thư mục**

text

```
twitter-auto-engage/
├── src/
│   ├── browser.js
│   ├── auth.js
│   ├── ai.js
│   ├── engage.js          # Thêm follow logic
│   ├── database.js        # Mới: MongoDB connection & models
│   ├── dashboard.js       # Mới: Express server
│   └── index.js
├── accounts/
├── .env
├── package.json
└── config.js
```

## **1. Cài đặt thêm dependencies**

bash

```
npm install express socket.io mongoose mongodb
npm install --save-dev nodemon
```

## **2. File cấu hình cập nhật** `config.js`

javascript

```
// config.js
module.exports = {
  // Delay settings (milliseconds)
  delays: {
    betweenActions: { min: 30000, max: 90000 },
    betweenAccounts: { min: 120000, max: 300000 },
    betweenSearchRounds: { min: 300000, max: 600000 },
    typing: { min: 50, max: 150 },
    scroll: { min: 500, max: 1500 },
  },
  
  // Interaction settings
  interactions: {
    maxPerDay: 80,              // Tăng lên 80/ngày
    maxPerAccountPerRun: 20,
    likeRatio: 0.5,             // 50% like
    retweetRatio: 0.15,         // 15% retweet
    replyRatio: 0.2,            // 20% reply
    followRatio: 0.15,          // 15% follow (mới)
    followBackWaitDays: 3,      // Chờ 3 ngày để unfollow nếu không follow lại
  },
  
  // Browser settings
  browser: {
    headless: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 },
  },
  
  // Gemini settings
  gemini: {
    model: 'gemini-1.5-flash',
    temperature: 0.9,
  },
  
  // Database settings
  database: {
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/twitter_bot',
  },
  
  // Dashboard settings
  dashboard: {
    port: 3000,
    username: 'admin',
    password: 'admin123',  // Nên đổi trong production
  },
  
  // Keywords for Web3
  keywords: [
    'web3', 'crypto', 'blockchain', 'defi', 'nft',
    'ethereum', 'solana', 'bitcoin', 'smart contract',
    'dapp', 'dao', 'layer2', 'zero knowledge'
  ],
};
```

## **3. Database Layer** `src/database.js`

javascript

```
// src/database.js
const mongoose = require('mongoose');

// Schema cho tweet đã tương tác
const interactedTweetSchema = new mongoose.Schema({
  tweetId: { type: String, required: true, unique: true },
  tweetUrl: { type: String, required: true },
  authorUsername: { type: String, required: true },
  authorId: { type: String },
  content: { type: String },
  interactedAt: { type: Date, default: Date.now },
  interactionType: { type: String, enum: ['like', 'retweet', 'reply', 'follow'], required: true },
  accountName: { type: String, required: true },
  keywordUsed: { type: String },
  aiGeneratedReply: { type: String },
});

// Schema cho user đã follow
const followedUserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  followedAt: { type: Date, default: Date.now },
  accountName: { type: String, required: true },
  followedBack: { type: Boolean, default: false },
  checkedFollowBackAt: { type: Date },
  unfollowed: { type: Boolean, default: false },
});

// Schema cho thống kê hàng ngày
const dailyStatsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD
  totalInteractions: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  retweets: { type: Number, default: 0 },
  replies: { type: Number, default: 0 },
  follows: { type: Number, default: 0 },
  byAccount: {
    type: Map,
    of: {
      interactions: Number,
      likes: Number,
      retweets: Number,
      replies: Number,
      follows: Number,
    },
    default: {},
  },
});

// Schema cho log hoạt động
const activityLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  accountName: { type: String, required: true },
  action: { type: String, enum: ['like', 'retweet', 'reply', 'follow', 'unfollow', 'login', 'error'], required: true },
  target: { type: String }, // tweet url hoặc username
  details: { type: mongoose.Schema.Types.Mixed },
  success: { type: Boolean, default: true },
  errorMessage: { type: String },
});

const InteractedTweet = mongoose.model('InteractedTweet', interactedTweetSchema);
const FollowedUser = mongoose.model('FollowedUser', followedUserSchema);
const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

class Database {
  constructor(uri) {
    this.uri = uri;
    this.connected = false;
  }

  async connect() {
    try {
      await mongoose.connect(this.uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      this.connected = true;
      console.log('✅ MongoDB connected successfully');
    } catch (error) {
      console.error('❌ MongoDB connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    await mongoose.disconnect();
    this.connected = false;
    console.log('MongoDB disconnected');
  }

  // Kiểm tra tweet đã tương tác chưa
  async hasInteractedWithTweet(tweetId, accountName) {
    const exists = await InteractedTweet.findOne({ tweetId, accountName });
    return !!exists;
  }

  // Lưu tweet đã tương tác
  async saveInteractedTweet(data) {
    try {
      const tweet = new InteractedTweet(data);
      await tweet.save();
      return tweet;
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key - đã tồn tại
        return null;
      }
      throw error;
    }
  }

  // Kiểm tra đã follow user chưa
  async hasFollowedUser(userId, accountName) {
    const exists = await FollowedUser.findOne({ userId, accountName, unfollowed: false });
    return !!exists;
  }

  // Lưu user đã follow
  async saveFollowedUser(data) {
    try {
      const user = new FollowedUser(data);
      await user.save();
      return user;
    } catch (error) {
      if (error.code !== 11000) throw error;
      return null;
    }
  }

  // Lấy danh sách user cần kiểm tra follow back
  async getUsersToCheckFollowBack(accountName, olderThanDays = 3) {
    const date = new Date();
    date.setDate(date.getDate() - olderThanDays);
    
    return await FollowedUser.find({
      accountName,
      followedBack: false,
      unfollowed: false,
      followedAt: { $lte: date },
    });
  }

  // Cập nhật follow back status
  async updateFollowBackStatus(userId, accountName, followedBack) {
    await FollowedUser.updateOne(
      { userId, accountName },
      { followedBack, checkedFollowBackAt: new Date() }
    );
  }

  // Đánh dấu đã unfollow
  async markUnfollowed(userId, accountName) {
    await FollowedUser.updateOne(
      { userId, accountName },
      { unfollowed: true }
    );
  }

  // Cập nhật thống kê hàng ngày
  async updateDailyStats(accountName, interactionType) {
    const today = new Date().toISOString().split('T')[0];
    
    let stats = await DailyStats.findOne({ date: today });
    if (!stats) {
      stats = new DailyStats({ date: today });
    }
    
    // Update tổng
    stats.totalInteractions += 1;
    stats[interactionType] = (stats[interactionType] || 0) + 1;
    
    // Update theo account
    if (!stats.byAccount.has(accountName)) {
      stats.byAccount.set(accountName, {
        interactions: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        follows: 0,
      });
    }
    
    const accountStats = stats.byAccount.get(accountName);
    accountStats.interactions += 1;
    accountStats[interactionType] = (accountStats[interactionType] || 0) + 1;
    
    await stats.save();
    return stats;
  }

  // Lấy thống kê cho dashboard
  async getStats(startDate, endDate) {
    const query = {};
    if (startDate) query.date = { $gte: startDate };
    if (endDate) query.date = { ...query.date, $lte: endDate };
    
    const stats = await DailyStats.find(query).sort({ date: -1 }).limit(30);
    
    // Lấy tổng số liệu
    const totals = await DailyStats.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalInteractions: { $sum: '$totalInteractions' },
          likes: { $sum: '$likes' },
          retweets: { $sum: '$retweets' },
          replies: { $sum: '$replies' },
          follows: { $sum: '$follows' },
        },
      },
    ]);
    
    return {
      stats,
      totals: totals[0] || { totalInteractions: 0, likes: 0, retweets: 0, replies: 0, follows: 0 },
    };
  }

  // Log activity
  async logActivity(data) {
    const log = new ActivityLog(data);
    await log.save();
    return log;
  }

  // Lấy recent activities
  async getRecentActivities(limit = 50) {
    return await ActivityLog.find().sort({ timestamp: -1 }).limit(limit);
  }

  // Đếm interactions hôm nay của account
  async getTodayInteractionCount(accountName) {
    const today = new Date().toISOString().split('T')[0];
    const stats = await DailyStats.findOne({ date: today });
    
    if (stats && stats.byAccount.has(accountName)) {
      return stats.byAccount.get(accountName).interactions;
    }
    return 0;
  }
}

module.exports = Database;
```

## **4. Dashboard với Express & [Socket.IO](http://Socket.IO)** `src/dashboard.js`

javascript

```
// src/dashboard.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

class Dashboard {
  constructor(database, config) {
    this.db = database;
    this.config = config;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIO(this.server);
    this.clients = new Set();
  }

  setupRoutes() {
    // Middleware
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));
    
    // Basic auth middleware
    const auth = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('Authentication required');
      }
      
      const base64 = authHeader.split(' ')[1];
      const [username, password] = Buffer.from(base64, 'base64').toString().split(':');
      
      if (username === this.config.dashboard.username && password === this.config.dashboard.password) {
        return next();
      }
      
      res.status(401).send('Invalid credentials');
    };
    
    // API routes
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
        const limit = parseInt(req.query.limit) || 50;
        const activities = await this.db.getRecentActivities(limit);
        res.json(activities);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    this.app.get('/api/accounts', auth, async (req, res) => {
      // Lấy danh sách account từ file system
      const fs = require('fs').promises;
      const accountsDir = './accounts';
      try {
        const files = await fs.readdir(accountsDir);
        const accounts = files
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''));
        res.json({ accounts });
      } catch {
        res.json({ accounts: [] });
      }
    });
    
    this.app.post('/api/control/start', auth, (req, res) => {
      // Emit event để bot bắt đầu
      this.io.emit('control', { action: 'start', data: req.body });
      res.json({ success: true, message: 'Start command sent' });
    });
    
    this.app.post('/api/control/stop', auth, (req, res) => {
      this.io.emit('control', { action: 'stop' });
      res.json({ success: true, message: 'Stop command sent' });
    });
    
    // Serve dashboard HTML
    this.app.get('/', auth, (req, res) => {
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
    });
  }
  
  setupSocket() {
    this.io.on('connection', (socket) => {
      console.log('Dashboard client connected');
      this.clients.add(socket);
      
      socket.on('disconnect', () => {
        this.clients.delete(socket);
        console.log('Dashboard client disconnected');
      });
    });
  }
  
  async sendStatsUpdate() {
    const stats = await this.db.getStats();
    const activities = await this.db.getRecentActivities(20);
    
    this.io.emit('stats-update', {
      stats: stats.totals,
      chartData: stats.stats,
      recentActivities: activities,
      timestamp: new Date(),
    });
  }
  
  async start(port) {
    this.setupRoutes();
    this.setupSocket();
    
    // Auto send stats every 10 seconds
    setInterval(() => {
      if (this.clients.size > 0) {
        this.sendStatsUpdate();
      }
    }, 10000);
    
    this.server.listen(port, () => {
      console.log(`📊 Dashboard running at http://localhost:${port}`);
      console.log(`   Username: ${this.config.dashboard.username}`);
      console.log(`   Password: ${this.config.dashboard.password}`);
    });
  }
}

module.exports = Dashboard;
```

## **5. Dashboard HTML Template** `public/dashboard.html`

html

```
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Twitter Bot Dashboard</title>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 5px;
        }
        
        .header p {
            color: #666;
            font-size: 14px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .stat-card {
            background: white;
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            transition: transform 0.3s;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-card .icon {
            font-size: 40px;
            margin-bottom: 10px;
        }
        
        .stat-card .value {
            font-size: 36px;
            font-weight: bold;
            color: #333;
        }
        
        .stat-card .label {
            color: #666;
            font-size: 14px;
            margin-top: 5px;
        }
        
        .stat-card.like .icon { color: #e74c3c; }
        .stat-card.retweet .icon { color: #2ecc71; }
        .stat-card.reply .icon { color: #3498db; }
        .stat-card.follow .icon { color: #9b59b6; }
        
        .chart-container {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        
        .chart-container h3 {
            margin-bottom: 20px;
            color: #333;
        }
        
        .activities {
            background: white;
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        
        .activities h3 {
            margin-bottom: 20px;
            color: #333;
        }
        
        .activity-list {
            max-height: 400px;
            overflow-y: auto;
        }
        
        .activity-item {
            padding: 12px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .activity-item:hover {
            background: #f9f9f9;
        }
        
        .activity-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
        }
        
        .activity-icon.like { background: #fee; color: #e74c3c; }
        .activity-icon.retweet { background: #efe; color: #2ecc71; }
        .activity-icon.reply { background: #eef; color: #3498db; }
        .activity-icon.follow { background: #f4e; color: #9b59b6; }
        
        .activity-details {
            flex: 1;
        }
        
        .activity-action {
            font-weight: 600;
            color: #333;
        }
        
        .activity-target {
            color: #666;
            font-size: 12px;
            margin-top: 4px;
            word-break: break-all;
        }
        
        .activity-time {
            color: #999;
            font-size: 12px;
        }
        
        .control-panel {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-top: 20px;
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        
        .btn {
            padding: 12px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .btn-start {
            background: #2ecc71;
            color: white;
        }
        
        .btn-start:hover {
            background: #27ae60;
            transform: scale(1.05);
        }
        
        .btn-stop {
            background: #e74c3c;
            color: white;
        }
        
        .btn-stop:hover {
            background: #c0392b;
            transform: scale(1.05);
        }
        
        .online-status {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #2ecc71;
            margin-left: 10px;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }
        
        .refresh-time {
            font-size: 12px;
            color: #999;
            margin-top: 10px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                🤖 Twitter Bot Dashboard
                <span class="online-status"></span>
            </h1>
            <p>Real-time monitoring & control for your Twitter engagement bot</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card like">
                <div class="icon">❤️</div>
                <div class="value" id="totalLikes">0</div>
                <div class="label">Total Likes</div>
            </div>
            <div class="stat-card retweet">
                <div class="icon">🔄</div>
                <div class="value" id="totalRetweets">0</div>
                <div class="label">Total Retweets</div>
            </div>
            <div class="stat-card reply">
                <div class="icon">💬</div>
                <div class="value" id="totalReplies">0</div>
                <div class="label">Total Replies</div>
            </div>
            <div class="stat-card follow">
                <div class="icon">➕</div>
                <div class="value" id="totalFollows">0</div>
                <div class="label">Total Follows</div>
            </div>
        </div>
        
        <div class="chart-container">
            <h3>📈 Daily Interactions</h3>
            <canvas id="interactionChart" width="400" height="200"></canvas>
        </div>
        
        <div class="activities">
            <h3>📋 Recent Activities</h3>
            <div class="activity-list" id="activityList">
                <div style="text-align: center; padding: 20px; color: #999;">Loading activities...</div>
            </div>
        </div>
        
        <div class="control-panel">
            <button class="btn btn-start" onclick="controlBot('start')">▶ Start Bot</button>
            <button class="btn btn-stop" onclick="controlBot('stop')">⏹ Stop Bot</button>
        </div>
        
        <div class="refresh-time" id="refreshTime">Last update: --:--:--</div>
    </div>
    
    <script>
        let interactionChart = null;
        let socket = null;
        
        // Initialize chart
        function initChart() {
            const ctx = document.getElementById('interactionChart').getContext('2d');
            interactionChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Likes',
                            data: [],
                            borderColor: '#e74c3c',
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Retweets',
                            data: [],
                            borderColor: '#2ecc71',
                            backgroundColor: 'rgba(46, 204, 113, 0.1)',
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Replies',
                            data: [],
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Follows',
                            data: [],
                            borderColor: '#9b59b6',
                            backgroundColor: 'rgba(155, 89, 182, 0.1)',
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Interactions'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Date'
                            }
                        }
                    }
                }
            });
        }
        
        // Update dashboard with real-time data
        function updateDashboard(data) {
            // Update stats
            document.getElementById('totalLikes').textContent = data.stats?.likes || 0;
            document.getElementById('totalRetweets').textContent = data.stats?.retweets || 0;
            document.getElementById('totalReplies').textContent = data.stats?.replies || 0;
            document.getElementById('totalFollows').textContent = data.stats?.follows || 0;
            
            // Update chart
            if (data.chartData && interactionChart) {
                const reversed = [...data.chartData].reverse();
                interactionChart.data.labels = reversed.map(d => d.date);
                interactionChart.data.datasets[0].data = reversed.map(d => d.likes || 0);
                interactionChart.data.datasets[1].data = reversed.map(d => d.retweets || 0);
                interactionChart.data.datasets[2].data = reversed.map(d => d.replies || 0);
                interactionChart.data.datasets[3].data = reversed.map(d => d.follows || 0);
                interactionChart.update();
            }
            
            // Update activities
            if (data.recentActivities) {
                const activityList = document.getElementById('activityList');
                if (data.recentActivities.length === 0) {
                    activityList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">No activities yet</div>';
                } else {
                    activityList.innerHTML = data.recentActivities.map(activity => `
                        <div class="activity-item">
                            <div class="activity-icon ${activity.action}">
                                ${getActionIcon(activity.action)}
                            </div>
                            <div class="activity-details">
                                <div class="activity-action">
                                    ${activity.accountName} • ${activity.action.toUpperCase()}
                                    ${activity.success ? '✅' : '❌'}
                                </div>
                                <div class="activity-target">
                                    ${activity.target || 'N/A'}
                                </div>
                            </div>
                            <div class="activity-time">
                                ${formatTime(activity.timestamp)}
                            </div>
                        </div>
                    `).join('');
                }
            }
            
            document.getElementById('refreshTime').textContent = `Last update: ${formatTime(data.timestamp)}`;
        }
        
        function getActionIcon(action) {
            const icons = {
                like: '❤️',
                retweet: '🔄',
                reply: '💬',
                follow: '➕',
                login: '🔐',
                error: '⚠️'
            };
            return icons[action] || '📝';
        }
        
        function formatTime(timestamp) {
            if (!timestamp) return '--:--:--';
            const date = new Date(timestamp);
            return date.toLocaleTimeString();
        }
        
        function controlBot(action) {
            if (!socket) return;
            socket.emit('control', { action: action === 'start' ? 'start' : 'stop' });
            
            // Show feedback
            const btn = action === 'start' ? 'Start' : 'Stop';
            const statusDiv = document.createElement('div');
            statusDiv.textContent = `${btn} command sent!`;
            statusDiv.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: ${action === 'start' ? '#2ecc71' : '#e74c3c'};
                color: white;
                padding: 10px 20px;
                border-radius: 8px;
                animation: fadeOut 2s forwards;
            `;
            document.body.appendChild(statusDiv);
            setTimeout(() => statusDiv.remove(), 2000);
        }
        
        // Initialize Socket.IO connection
        function initSocket() {
            socket = io();
            
            socket.on('connect', () => {
                console.log('Connected to dashboard server');
            });
            
            socket.on('stats-update', (data) => {
                updateDashboard(data);
            });
            
            socket.on('control', (data) => {
                console.log('Control command received:', data);
            });
        }
        
        // Initial fetch and setup
        async function initialFetch() {
            try {
                const response = await fetch('/api/stats');
                const data = await response.json();
                updateDashboard({ stats: data.totals, chartData: data.stats, recentActivities: [], timestamp: new Date() });
                
                const activitiesRes = await fetch('/api/activities?limit=20');
                const activities = await activitiesRes.json();
                updateDashboard({ stats: data.totals, chartData: data.stats, recentActivities: activities, timestamp: new Date() });
            } catch (error) {
                console.error('Initial fetch error:', error);
            }
        }
        
        // Add fade out animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeOut {
                0% { opacity: 1; }
                70% { opacity: 1; }
                100% { opacity: 0; visibility: hidden; }
            }
        `;
        document.head.appendChild(style);
        
        // Initialize
        initChart();
        initSocket();
        initialFetch();
    </script>
</body>
</html>
```

## **6. Cập nhật Engagement Bot với Follow & Database** `src/engage.js`

javascript

```
// src/engage.js (cập nhật)
class EngagementBot {
  constructor(browserManager, authManager, aiService, database, config) {
    this.browser = browserManager;
    this.auth = authManager;
    this.ai = aiService;
    this.db = database;
    this.config = config;
    this.isRunning = true;
    this.currentAccount = null;
  }

  async randomDelay(min, max) {
    const delay = Math.random() * (max - min) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async humanType(page, selector, text) {
    await page.click(selector);
    for (const char of text) {
      await page.type(selector, char, { delay: this.randomDelay(50, 150) });
      await this.randomDelay(20, 50);
    }
  }

  // NEW: Follow user
  async followUser(page, tweetUrl, username) {
    try {
      // Đi đến profile của user
      await page.goto(`https://twitter.com/${username}`);
      await this.randomDelay(2000, 3000);
      
      // Kiểm tra đã follow chưa
      const followButton = await page.$('button[data-testid$="-follow"]');
      if (!followButton) return false;
      
      const buttonText = await page.evaluate(btn => btn.textContent, followButton);
      if (buttonText && buttonText.toLowerCase().includes('following')) {
        console.log(`ℹ️ Already following @${username}`);
        return false;
      }
      
      await followButton.click();
      await this.randomDelay(1000, 1500);
      
      console.log(`➕ Followed @${username}`);
      
      // Lưu vào database
      await this.db.saveFollowedUser({
        userId: username, // Có thể lấy userId từ page nếu cần
        username: username,
        accountName: this.currentAccount,
      });
      
      await this.db.logActivity({
        accountName: this.currentAccount,
        action: 'follow',
        target: `@${username}`,
        success: true,
      });
      
      return true;
    } catch (error) {
      console.error(`Follow error: ${error.message}`);
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

  // NEW: Check and unfollow if not followed back
  async checkAndUnfollow(page, accountName) {
    const usersToCheck = await this.db.getUsersToCheckFollowBack(accountName, this.config.interactions.followBackWaitDays);
    
    for (const user of usersToCheck) {
      if (!this.isRunning) break;
      
      console.log(`🔍 Checking if @${user.username} followed back...`);
      await page.goto(`https://twitter.com/${user.username}`);
      await this.randomDelay(2000, 3000);
      
      const followersCount = await page.$eval('a[href$="/followers"]', el => {
        return parseInt(el.querySelector('span')?.textContent?.replace(/\D/g, '') || '0');
      }).catch(() => 0);
      
      // Kiểm tra xem có follow lại không (logic đơn giản: check button text)
      const followButton = await page.$('button[data-testid$="-follow"]');
      let followedBack = false;
      
      if (followButton) {
        const buttonText = await page.evaluate(btn => btn.textContent, followButton);
        followedBack = buttonText && buttonText.toLowerCase().includes('follow back');
      }
      
      if (followedBack) {
        await this.db.updateFollowBackStatus(user.userId, accountName, true);
        console.log(`✅ @${user.username} followed back!`);
      } else {
        // Unfollow
        const unfollowButton = await page.$('button[data-testid$="-unfollow"]');
        if (unfollowButton) {
          await unfollowButton.click();
          await this.randomDelay(500, 1000);
          
          const confirmButton = await page.$('button[data-testid="unfollowConfirm"]');
          if (confirmButton) {
            await confirmButton.click();
            console
```

*Phản hồi này do AI tạo ra, chỉ mang tính tham khảo.*

  
